use std::os::fd::OwnedFd;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use kiko_driver::DriverError;
use pipewire as pw;
use pw::spa;

use crate::error::failed;

const WAIT: Duration = Duration::from_secs(2);

pub(crate) struct Frames {
    latest: Arc<Mutex<Option<Frame>>>,
}

pub(crate) struct Frame {
    data: Vec<u8>,
    width: u32,
    height: u32,
    stride: u32,
    format: spa::param::video::VideoFormat,
}

struct Sink {
    format: spa::param::video::VideoInfoRaw,
    latest: Arc<Mutex<Option<Frame>>>,
}

impl Frames {
    pub fn start(fd: OwnedFd, node: u32) -> Result<Self, DriverError> {
        let latest = Arc::new(Mutex::new(None));
        let (ready, wait) = mpsc::channel();
        let thread_latest = Arc::clone(&latest);
        std::thread::Builder::new()
            .name("kiko-frames".to_string())
            .spawn(move || run(fd, node, thread_latest, ready))
            .map_err(|error| failed(format!("could not start the frame reader: {error}")))?;
        wait.recv()
            .map_err(|_| failed("the frame reader stopped before it started"))??;
        Ok(Self { latest })
    }

    pub fn latest(&self) -> Option<Frame> {
        self.wait(WAIT)
    }

    fn wait(&self, budget: Duration) -> Option<Frame> {
        let deadline = Instant::now() + budget;
        loop {
            if let Some(frame) = self.frame() {
                return Some(frame);
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn frame(&self) -> Option<Frame> {
        let guard = self.latest.lock().ok()?;
        guard.as_ref().map(Frame::copy)
    }
}

impl Frame {
    fn copy(&self) -> Self {
        Self {
            data: self.data.clone(),
            width: self.width,
            height: self.height,
            stride: self.stride,
            format: self.format,
        }
    }

    pub fn to_rgb(&self) -> Result<image::RgbImage, DriverError> {
        let (width, height) = (self.width as usize, self.height as usize);
        let stride = self.stride as usize;
        if width == 0 || height == 0 || stride < width * 4 {
            return Err(failed("the shared window sent an empty frame"));
        }
        let mut rgb = Vec::with_capacity(width * height * 3);
        for row in 0..height {
            let start = row * stride;
            let end = start + width * 4;
            if end > self.data.len() {
                return Err(failed("the shared window sent a short frame"));
            }
            for pixel in self.data[start..end].as_chunks::<4>().0 {
                let (red, green, blue) = self.pixel(pixel)?;
                rgb.extend_from_slice(&[red, green, blue]);
            }
        }
        image::RgbImage::from_raw(self.width, self.height, rgb)
            .ok_or_else(|| failed("the frame is the wrong size"))
    }

    fn pixel(&self, pixel: &[u8; 4]) -> Result<(u8, u8, u8), DriverError> {
        use spa::param::video::VideoFormat;
        match self.format {
            VideoFormat::BGRA | VideoFormat::BGRx => Ok((pixel[2], pixel[1], pixel[0])),
            VideoFormat::RGBA | VideoFormat::RGBx => Ok((pixel[0], pixel[1], pixel[2])),
            other => Err(failed(format!("the shared window sent {other:?} pixels"))),
        }
    }
}

fn run(
    fd: OwnedFd,
    node: u32,
    latest: Arc<Mutex<Option<Frame>>>,
    ready: mpsc::Sender<Result<(), DriverError>>,
) {
    let outcome = start(fd, node, latest);
    match outcome {
        Ok(mainloop) => {
            let _ = ready.send(Ok(()));
            mainloop.run();
        }
        Err(error) => {
            let _ = ready.send(Err(error));
        }
    }
}

fn start(
    fd: OwnedFd,
    node: u32,
    latest: Arc<Mutex<Option<Frame>>>,
) -> Result<pw::main_loop::MainLoopRc, DriverError> {
    pw::init();
    let mainloop = pw::main_loop::MainLoopRc::new(None)
        .map_err(|error| failed(format!("could not open a PipeWire loop: {error}")))?;
    let context = pw::context::ContextRc::new(&mainloop, None)
        .map_err(|error| failed(format!("could not open a PipeWire context: {error}")))?;
    let core = context
        .connect_fd_rc(fd, None)
        .map_err(|error| failed(format!("could not connect to the screen share: {error}")))?;
    let stream = pw::stream::StreamRc::new(
        core,
        "kiko-capture",
        pw::properties::properties! {
            *pw::keys::MEDIA_TYPE => "Video",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
        },
    )
    .map_err(|error| failed(format!("could not create the capture stream: {error}")))?;
    let sink = Sink {
        format: Default::default(),
        latest,
    };
    let _listener = stream
        .add_local_listener_with_user_data(sink)
        .param_changed(|_, sink, id, param| {
            if id != spa::param::ParamType::Format.as_raw() {
                return;
            }
            if let Some(param) = param {
                let _ = sink.format.parse(param);
            }
        })
        .process(|stream, sink| {
            let Some(mut buffer) = stream.dequeue_buffer() else {
                return;
            };
            let Some(data) = buffer.datas_mut().first_mut() else {
                return;
            };
            let (offset, size, stride) = (
                data.chunk().offset() as usize,
                data.chunk().size() as usize,
                data.chunk().stride() as usize,
            );
            let Some(bytes) = data.data() else {
                return;
            };
            let end = (offset + size).min(bytes.len());
            if size == 0 || stride == 0 || end <= offset {
                return;
            }
            let size = sink.format.size();
            let frame = Frame {
                data: bytes[offset..end].to_vec(),
                width: size.width,
                height: size.height,
                stride: stride as u32,
                format: sink.format.format(),
            };
            if let Ok(mut latest) = sink.latest.lock() {
                *latest = Some(frame);
            }
        })
        .register()
        .map_err(|error| failed(format!("could not watch the capture stream: {error}")))?;
    let mut params = [format()?];
    stream
        .connect(
            spa::utils::Direction::Input,
            Some(node),
            pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS,
            &mut params,
        )
        .map_err(|error| failed(format!("could not read the screen share: {error}")))?;
    std::mem::forget(_listener);
    Ok(mainloop)
}

fn format() -> Result<&'static spa::pod::Pod, DriverError> {
    use spa::param::format::{FormatProperties, MediaSubtype, MediaType};
    use spa::param::video::VideoFormat;
    use spa::pod::property;
    use spa::utils::{Fraction, Rectangle};

    let object = spa::pod::object!(
        spa::utils::SpaTypes::ObjectParamFormat,
        spa::param::ParamType::EnumFormat,
        property!(FormatProperties::MediaType, Id, MediaType::Video),
        property!(FormatProperties::MediaSubtype, Id, MediaSubtype::Raw),
        property!(
            FormatProperties::VideoFormat,
            Choice,
            Enum,
            Id,
            VideoFormat::BGRA,
            VideoFormat::BGRA,
            VideoFormat::BGRx,
            VideoFormat::RGBA,
            VideoFormat::RGBx
        ),
        property!(
            FormatProperties::VideoSize,
            Choice,
            Range,
            Rectangle,
            Rectangle {
                width: 1920,
                height: 1080
            },
            Rectangle {
                width: 1,
                height: 1
            },
            Rectangle {
                width: 8192,
                height: 8192
            }
        ),
        property!(
            FormatProperties::VideoFramerate,
            Choice,
            Range,
            Fraction,
            Fraction { num: 30, denom: 1 },
            Fraction { num: 0, denom: 1 },
            Fraction {
                num: 1000,
                denom: 1
            }
        ),
    );
    let bytes = spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &spa::pod::Value::Object(object),
    )
    .map_err(|error| failed(format!("could not describe the capture format: {error}")))?
    .0
    .into_inner();
    spa::pod::Pod::from_bytes(Box::leak(bytes.into_boxed_slice()))
        .ok_or_else(|| failed("the capture format is not a PipeWire pod"))
}
