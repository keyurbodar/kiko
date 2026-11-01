use std::ffi::c_void;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use image::RgbImage;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use kiko_driver::api::{Image, Rect};
use windows::Foundation::Metadata::ApiInformation;
use windows::Graphics::Capture::{
    Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{E_FAIL, E_POINTER, HMODULE, HWND, RECT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D::D3D_FEATURE_LEVEL_11_0;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ,
    D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleBitmap, CreateCompatibleDC,
    DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, HGDIOBJ, ReleaseDC, SelectObject,
};
use windows::Win32::Storage::Xps::{PRINT_WINDOW_FLAGS, PrintWindow};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
use windows::core::{HSTRING, Interface};

use crate::hwnd;

const PW_RENDERFULLCONTENT: PRINT_WINDOW_FLAGS = PRINT_WINDOW_FLAGS(2);
const FRAME_WAIT: Duration = Duration::from_millis(1500);
const FRAME_POLL: Duration = Duration::from_millis(50);
const JPEG_QUALITY: u8 = 80;
const BLACK_THRESHOLD: u8 = 8;

pub fn supported() -> bool {
    let _com = crate::uia::ComGuard::init();
    ApiInformation::IsTypePresent(&HSTRING::from(
        "Windows.Graphics.Capture.GraphicsCaptureItem",
    ))
    .unwrap_or(false)
}

pub fn capture(window: isize, frame: Rect, max_width: u32) -> Option<Image> {
    let _com = crate::uia::ComGuard::init();
    if !forced_print_window()
        && let Some((pixels, width, height)) = wgc(window)
    {
        return encode(&pixels, width, height, frame, max_width);
    }
    let (pixels, width, height) = print_window(window, frame)?;
    encode(&pixels, width, height, frame, max_width)
}

fn forced_print_window() -> bool {
    std::env::var_os("KIKO_FORCE_PRINT_WINDOW").is_some_and(|value| value != "0")
}

fn wgc(window: isize) -> Option<(Vec<u8>, u32, u32)> {
    match unsafe { wgc_impl(hwnd::handle(window)) } {
        Ok(frame) => Some(frame),
        Err(error) => {
            eprintln!("kiko: window capture fell back to PrintWindow: {error}");
            None
        }
    }
}

unsafe fn wgc_impl(window: HWND) -> windows::core::Result<(Vec<u8>, u32, u32)> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            Some(&[D3D_FEATURE_LEVEL_11_0]),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
    }
    let device = device.ok_or_else(|| windows::core::Error::from(E_POINTER))?;
    let context = context.ok_or_else(|| windows::core::Error::from(E_POINTER))?;
    let dxgi: IDXGIDevice = device.cast()?;
    let inspectable = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }?;
    let direct3d: IDirect3DDevice = inspectable.cast()?;
    let interop: IGraphicsCaptureItemInterop =
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
    let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(window) }?;
    let size = item.Size()?;
    if size.Width <= 0 || size.Height <= 0 {
        return Err(windows::core::Error::from(E_FAIL));
    }
    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &direct3d,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        size,
    )?;
    let session = pool.CreateCaptureSession(&item)?;
    if border_supported() {
        let _ = session.SetIsBorderRequired(false);
    }
    let _ = session.SetIsCursorCaptureEnabled(false);
    session.StartCapture()?;
    let frame = wait_for_frame(&pool)?;
    let surface = frame.Surface()?;
    let access: IDirect3DDxgiInterfaceAccess = surface.cast()?;
    let texture: ID3D11Texture2D = unsafe { access.GetInterface() }?;
    let (pixels, width, height) = unsafe { read_texture(&device, &context, &texture) }?;
    let _ = session.Close();
    let _ = pool.Close();
    Ok((pixels, width, height))
}

fn border_supported() -> bool {
    ApiInformation::IsPropertyPresent(
        &HSTRING::from("Windows.Graphics.Capture.GraphicsCaptureSession"),
        &HSTRING::from("IsBorderRequired"),
    )
    .unwrap_or(false)
}

fn wait_for_frame(
    pool: &Direct3D11CaptureFramePool,
) -> windows::core::Result<Direct3D11CaptureFrame> {
    let deadline = Instant::now() + FRAME_WAIT;
    while Instant::now() < deadline {
        if let Ok(frame) = pool.TryGetNextFrame() {
            return Ok(frame);
        }
        std::thread::sleep(FRAME_POLL);
    }
    Err(windows::core::Error::from(E_FAIL))
}

unsafe fn read_texture(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    texture: &ID3D11Texture2D,
) -> windows::core::Result<(Vec<u8>, u32, u32)> {
    let mut description = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut description) };
    description.Usage = D3D11_USAGE_STAGING;
    description.BindFlags = 0;
    description.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
    description.MiscFlags = 0;
    let mut staging: Option<ID3D11Texture2D> = None;
    unsafe { device.CreateTexture2D(&description, None, Some(&mut staging)) }?;
    let staging = staging.ok_or_else(|| windows::core::Error::from(E_POINTER))?;
    unsafe {
        context.CopyResource(&staging, texture);
    }
    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe { context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)) }?;
    let width = description.Width as usize;
    let height = description.Height as usize;
    let stride = mapped.RowPitch as usize;
    let mut pixels = vec![0u8; width * height * 4];
    let source = mapped.pData as *const u8;
    for row in 0..height {
        unsafe {
            std::ptr::copy_nonoverlapping(
                source.add(row * stride),
                pixels.as_mut_ptr().add(row * width * 4),
                width * 4,
            );
        }
    }
    unsafe { context.Unmap(&staging, 0) };
    Ok((pixels, description.Width, description.Height))
}

fn print_window(window: isize, frame: Rect) -> Option<(Vec<u8>, u32, u32)> {
    unsafe { print_window_impl(hwnd::handle(window), frame) }.ok()
}

unsafe fn print_window_impl(
    window: HWND,
    frame: Rect,
) -> windows::core::Result<(Vec<u8>, u32, u32)> {
    let mut window_rect = RECT::default();
    unsafe { GetWindowRect(window, &mut window_rect) }?;
    let width = window_rect.right - window_rect.left;
    let height = window_rect.bottom - window_rect.top;
    if width <= 0 || height <= 0 {
        return Err(windows::core::Error::from(E_FAIL));
    }
    let screen = unsafe { GetDC(None) };
    let memory = unsafe { CreateCompatibleDC(Some(screen)) };
    let bitmap = unsafe { CreateCompatibleBitmap(screen, width, height) };
    let previous = unsafe { SelectObject(memory, HGDIOBJ(bitmap.0)) };
    let rendered = unsafe { PrintWindow(window, memory, PW_RENDERFULLCONTENT) };
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let lines = unsafe {
        GetDIBits(
            memory,
            bitmap,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut c_void),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    unsafe {
        SelectObject(memory, previous);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
    }
    if !rendered.as_bool() || lines == 0 {
        return Err(windows::core::Error::from(E_FAIL));
    }
    if mostly_black(&pixels) {
        return Err(windows::core::Error::from(E_FAIL));
    }
    Ok(crop(pixels, width, height, window_rect, frame))
}

fn mostly_black(pixels: &[u8]) -> bool {
    let stride = (pixels.len() / 4 / 1024).max(1);
    let mut seen = 0usize;
    let mut lit = 0usize;
    for pixel in pixels.as_chunks::<4>().0.iter().step_by(stride) {
        seen += 1;
        if pixel[0] > BLACK_THRESHOLD || pixel[1] > BLACK_THRESHOLD || pixel[2] > BLACK_THRESHOLD {
            lit += 1;
        }
    }
    seen == 0 || lit * 100 < seen
}

fn crop(
    pixels: Vec<u8>,
    width: i32,
    height: i32,
    window_rect: RECT,
    frame: Rect,
) -> (Vec<u8>, u32, u32) {
    let offset_x = (frame.x as i32 - window_rect.left).clamp(0, width - 1);
    let offset_y = (frame.y as i32 - window_rect.top).clamp(0, height - 1);
    let crop_width = (frame.w as i32).clamp(1, width - offset_x);
    let crop_height = (frame.h as i32).clamp(1, height - offset_y);
    let mut cropped = vec![0u8; (crop_width * crop_height * 4) as usize];
    for row in 0..crop_height {
        let source = (((offset_y + row) * width + offset_x) * 4) as usize;
        let destination = (row * crop_width * 4) as usize;
        let length = (crop_width * 4) as usize;
        cropped[destination..destination + length]
            .copy_from_slice(&pixels[source..source + length]);
    }
    (cropped, crop_width as u32, crop_height as u32)
}

fn encode(pixels: &[u8], width: u32, height: u32, frame: Rect, max_width: u32) -> Option<Image> {
    if width == 0 || height == 0 || pixels.len() < (width as usize * height as usize * 4) {
        return None;
    }
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    for pixel in pixels.as_chunks::<4>().0 {
        rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
    }
    let image = RgbImage::from_raw(width, height, rgb)?;
    let image = if width > max_width.max(1) {
        let target = max_width.max(1);
        let height = ((height as f64) * (target as f64) / (width as f64))
            .round()
            .max(1.0) as u32;
        image::imageops::resize(&image, target, height, FilterType::Triangle)
    } else {
        image
    };
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
        .encode_image(&image)
        .ok()?;
    Some(Image {
        mime: "image/jpeg".into(),
        data: BASE64.encode(jpeg),
        width: image.width(),
        height: image.height(),
        covers: frame,
    })
}
