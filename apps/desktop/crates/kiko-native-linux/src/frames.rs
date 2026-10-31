use std::os::fd::OwnedFd;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use kiko_driver::DriverError;
use libspa::param::video::VideoFormat;

use crate::error::{failed, timeout};
use crate::pipewire::Reader;

const WAIT: Duration = Duration::from_secs(2);
const START: Duration = Duration::from_secs(5);

pub(crate) struct Frames {
    latest: Arc<Mutex<Option<Frame>>>,
}

pub(crate) struct Frame {
    data: Vec<u8>,
    width: u32,
    height: u32,
    stride: i32,
    format: VideoFormat,
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
        match wait.recv_timeout(START) {
            Ok(started) => started?,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err(timeout("the screen share did not start in time"));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(failed("the frame reader stopped before it started"));
            }
        }
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
    pub(crate) fn new(
        data: Vec<u8>,
        width: u32,
        height: u32,
        stride: i32,
        format: VideoFormat,
    ) -> Self {
        Self {
            data,
            width,
            height,
            stride,
            format,
        }
    }

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
        if width == 0 || height == 0 {
            return Err(failed("the shared window sent an empty frame"));
        }
        let Ok(stride) = usize::try_from(self.stride) else {
            return Err(failed("the shared window sent a backwards frame"));
        };
        if stride < width * 4 {
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
    match Reader::start(fd, node, latest) {
        Ok(reader) => {
            let _ = ready.send(Ok(()));
            reader.run();
        }
        Err(error) => {
            let _ = ready.send(Err(error));
        }
    }
}

#[cfg(test)]
mod tests {
    use libspa::param::video::VideoFormat;
    use std::collections::HashMap;
    use zbus::zvariant::{OwnedObjectPath, Value};

    use super::{Frame, Frames};

    async fn virtual_monitor() -> (zbus::Connection, std::os::fd::OwnedFd, u32) {
        use futures_util::StreamExt as _;

        let connection = zbus::Connection::session()
            .await
            .expect("the session bus is missing");
        let screencast = zbus::Proxy::new(
            &connection,
            "org.gnome.Mutter.ScreenCast",
            "/org/gnome/Mutter/ScreenCast",
            "org.gnome.Mutter.ScreenCast",
        )
        .await
        .expect("mutter is not running");
        let session: OwnedObjectPath = screencast
            .call("CreateSession", &(HashMap::<String, Value>::new(),))
            .await
            .expect("could not open a screencast session");
        let session = zbus::Proxy::new(
            &connection,
            "org.gnome.Mutter.ScreenCast",
            session.as_str(),
            "org.gnome.Mutter.ScreenCast.Session",
        )
        .await
        .expect("could not reach the screencast session");
        let stream: OwnedObjectPath = session
            .call("RecordVirtual", &(HashMap::<String, Value>::new(),))
            .await
            .expect("could not record the virtual monitor");
        let stream = zbus::Proxy::new(
            &connection,
            "org.gnome.Mutter.ScreenCast",
            stream.as_str(),
            "org.gnome.Mutter.ScreenCast.Stream",
        )
        .await
        .expect("could not reach the stream");
        let mut added = stream
            .receive_signal("PipeWireStreamAdded")
            .await
            .expect("could not watch the stream");
        session.call::<_, _, ()>("Start", &()).await.expect("start");
        let message = added.next().await.expect("the stream never started");
        let node = message
            .body()
            .deserialize::<u32>()
            .expect("the stream sent no node");
        let runtime = std::env::var_os("XDG_RUNTIME_DIR").expect("no runtime directory");
        let socket = std::os::unix::net::UnixStream::connect(
            std::path::Path::new(&runtime).join("pipewire-0"),
        )
        .expect("the PipeWire daemon is not running");
        (connection, socket.into(), node)
    }

    #[test]
    #[ignore]
    fn reads_frames_from_a_live_compositor_stream() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let (_connection, fd, node) = runtime.block_on(virtual_monitor());
        let frames = Frames::start(fd, node).expect("frame reader");
        let frame = frames
            .wait(std::time::Duration::from_secs(10))
            .expect("the compositor sent no frame");
        assert!(
            frame.width >= 640 && frame.height >= 480,
            "the compositor sent a {}x{} frame",
            frame.width,
            frame.height
        );
        let picture = frame.to_rgb().expect("the frame is not a picture");
        assert!(
            picture.pixels().any(|pixel| pixel.0 != [0, 0, 0]),
            "the frame is blank"
        );
    }

    fn frame(data: Vec<u8>, width: u32, height: u32, stride: i32) -> Frame {
        Frame {
            data,
            width,
            height,
            stride,
            format: VideoFormat::BGRA,
        }
    }

    #[test]
    fn reads_bgra_pixels() {
        let picture = frame(
            vec![0x10, 0x20, 0x30, 0xff, 0x40, 0x50, 0x60, 0xff],
            2,
            1,
            8,
        )
        .to_rgb()
        .expect("a two pixel frame");
        assert_eq!(picture.get_pixel(0, 0).0, [0x30, 0x20, 0x10]);
        assert_eq!(picture.get_pixel(1, 0).0, [0x60, 0x50, 0x40]);
    }

    #[test]
    fn skips_padding_at_the_end_of_a_row() {
        let picture = frame(
            vec![0x10, 0x20, 0x30, 0xff, 0x00, 0x00, 0x00, 0x00],
            1,
            1,
            8,
        )
        .to_rgb()
        .expect("one padded pixel");
        assert_eq!(picture.get_pixel(0, 0).0, [0x30, 0x20, 0x10]);
    }

    #[test]
    fn rejects_a_short_frame() {
        assert!(
            frame(vec![0x10, 0x20, 0x30, 0xff], 2, 1, 8)
                .to_rgb()
                .is_err()
        );
    }

    #[test]
    fn rejects_a_backwards_frame() {
        assert!(
            frame(vec![0x10, 0x20, 0x30, 0xff], 1, 1, -4)
                .to_rgb()
                .is_err()
        );
    }
}
