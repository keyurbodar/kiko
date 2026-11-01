use std::ffi::{c_char, c_int, c_void};
use std::os::fd::{IntoRawFd, OwnedFd};
use std::ptr;
use std::sync::{Arc, Mutex};

use kiko_driver::DriverError;
use libloading::Library;
use libspa::param::ParamType;
use libspa::param::video::{VideoFormat, VideoInfoRaw};
use libspa::pod::Pod;
use libspa::sys;

use crate::error::{failed, unsupported};
use crate::frames::Frame;

const LIBRARY: &str = "libpipewire-0.3.so.0";
const STREAM_EVENTS_VERSION: u32 = 2;
const STREAM_FLAG_AUTOCONNECT: i32 = 1;
const STREAM_FLAG_MAP_BUFFERS: i32 = 4;
const DIRECTION_INPUT: i32 = 0;

type Init = unsafe extern "C" fn(*mut c_int, *mut *mut *mut c_char);
type Deinit = unsafe extern "C" fn();
type MainLoopNew = unsafe extern "C" fn(*const sys::spa_dict) -> *mut c_void;
type MainLoopDestroy = unsafe extern "C" fn(*mut c_void);
type MainLoopRun = unsafe extern "C" fn(*mut c_void) -> c_int;
type MainLoopGetLoop = unsafe extern "C" fn(*mut c_void) -> *mut c_void;
type ContextNew = unsafe extern "C" fn(*mut c_void, *mut c_void, usize) -> *mut c_void;
type ContextDestroy = unsafe extern "C" fn(*mut c_void);
type ContextConnectFd = unsafe extern "C" fn(*mut c_void, c_int, *mut c_void, usize) -> *mut c_void;
type PropertiesNewDict = unsafe extern "C" fn(*const sys::spa_dict) -> *mut c_void;
type StreamNew = unsafe extern "C" fn(*mut c_void, *const c_char, *mut c_void) -> *mut c_void;
type StreamDestroy = unsafe extern "C" fn(*mut c_void);
type StreamAddListener =
    unsafe extern "C" fn(*mut c_void, *mut sys::spa_hook, *const StreamEvents, *mut c_void);
type StreamConnect =
    unsafe extern "C" fn(*mut c_void, i32, u32, i32, *const *const sys::spa_pod, u32) -> c_int;
type StreamDequeueBuffer = unsafe extern "C" fn(*mut c_void) -> *mut PwBuffer;
type StreamQueueBuffer = unsafe extern "C" fn(*mut c_void, *mut PwBuffer) -> c_int;

#[derive(Clone, Copy)]
struct Api {
    init: Init,
    deinit: Deinit,
    main_loop_new: MainLoopNew,
    main_loop_destroy: MainLoopDestroy,
    main_loop_run: MainLoopRun,
    main_loop_get_loop: MainLoopGetLoop,
    context_new: ContextNew,
    context_destroy: ContextDestroy,
    context_connect_fd: ContextConnectFd,
    properties_new_dict: PropertiesNewDict,
    stream_new: StreamNew,
    stream_destroy: StreamDestroy,
    stream_add_listener: StreamAddListener,
    stream_connect: StreamConnect,
    stream_dequeue_buffer: StreamDequeueBuffer,
    stream_queue_buffer: StreamQueueBuffer,
}

impl Api {
    fn load(library: &Library) -> Result<Self, DriverError> {
        unsafe {
            Ok(Self {
                init: *library.get(b"pw_init\0").map_err(missing)?,
                deinit: *library.get(b"pw_deinit\0").map_err(missing)?,
                main_loop_new: *library.get(b"pw_main_loop_new\0").map_err(missing)?,
                main_loop_destroy: *library.get(b"pw_main_loop_destroy\0").map_err(missing)?,
                main_loop_run: *library.get(b"pw_main_loop_run\0").map_err(missing)?,
                main_loop_get_loop: *library.get(b"pw_main_loop_get_loop\0").map_err(missing)?,
                context_new: *library.get(b"pw_context_new\0").map_err(missing)?,
                context_destroy: *library.get(b"pw_context_destroy\0").map_err(missing)?,
                context_connect_fd: *library.get(b"pw_context_connect_fd\0").map_err(missing)?,
                properties_new_dict: *library.get(b"pw_properties_new_dict\0").map_err(missing)?,
                stream_new: *library.get(b"pw_stream_new\0").map_err(missing)?,
                stream_destroy: *library.get(b"pw_stream_destroy\0").map_err(missing)?,
                stream_add_listener: *library.get(b"pw_stream_add_listener\0").map_err(missing)?,
                stream_connect: *library.get(b"pw_stream_connect\0").map_err(missing)?,
                stream_dequeue_buffer: *library
                    .get(b"pw_stream_dequeue_buffer\0")
                    .map_err(missing)?,
                stream_queue_buffer: *library.get(b"pw_stream_queue_buffer\0").map_err(missing)?,
            })
        }
    }
}

#[repr(C)]
struct PwBuffer {
    buffer: *mut sys::spa_buffer,
}

#[repr(C)]
struct StreamEvents {
    version: u32,
    destroy: Option<unsafe extern "C" fn(*mut c_void)>,
    state_changed: Option<unsafe extern "C" fn(*mut c_void, i32, i32, *const c_char)>,
    control_info: Option<unsafe extern "C" fn(*mut c_void, u32, *const c_void)>,
    io_changed: Option<unsafe extern "C" fn(*mut c_void, u32, *mut c_void, u32)>,
    param_changed: Option<unsafe extern "C" fn(*mut c_void, u32, *const sys::spa_pod)>,
    add_buffer: Option<unsafe extern "C" fn(*mut c_void, *mut PwBuffer)>,
    remove_buffer: Option<unsafe extern "C" fn(*mut c_void, *mut PwBuffer)>,
    process: Option<unsafe extern "C" fn(*mut c_void)>,
    drained: Option<unsafe extern "C" fn(*mut c_void)>,
    command: Option<unsafe extern "C" fn(*mut c_void, *const c_void)>,
    trigger_done: Option<unsafe extern "C" fn(*mut c_void)>,
}

struct Sink {
    api: Api,
    stream: *mut c_void,
    format: VideoInfoRaw,
    latest: Arc<Mutex<Option<Frame>>>,
}

impl Sink {
    fn read(&self) {
        let Some(buffer) =
            std::ptr::NonNull::new(unsafe { (self.api.stream_dequeue_buffer)(self.stream) })
        else {
            return;
        };
        self.store(buffer);
        unsafe { (self.api.stream_queue_buffer)(self.stream, buffer.as_ptr()) };
    }

    fn store(&self, buffer: std::ptr::NonNull<PwBuffer>) {
        let Some(spa_buffer) = std::ptr::NonNull::new(unsafe { buffer.as_ref().buffer }) else {
            return;
        };
        let Some(data) = first_data(unsafe { spa_buffer.as_ref() }) else {
            return;
        };
        let Some(chunk) = std::ptr::NonNull::new(data.chunk) else {
            return;
        };
        let chunk = unsafe { chunk.as_ref() };
        let Some(pixels) = std::ptr::NonNull::new(data.data.cast::<u8>()) else {
            return;
        };
        let offset = chunk.offset as usize;
        let size = chunk.size as usize;
        let end = offset.saturating_add(size).min(data.maxsize as usize);
        if size == 0 || chunk.stride == 0 || end <= offset {
            return;
        }
        let bytes =
            unsafe { std::slice::from_raw_parts(pixels.as_ptr().add(offset), end - offset) };
        let (width, height) = (self.format.size().width, self.format.size().height);
        let frame = Frame::new(
            bytes.to_vec(),
            width,
            height,
            chunk.stride,
            self.format.format(),
        );
        if let Ok(mut latest) = self.latest.lock() {
            *latest = Some(frame);
        }
    }
}

fn first_data(buffer: &sys::spa_buffer) -> Option<&sys::spa_data> {
    if buffer.n_datas == 0 || buffer.datas.is_null() {
        return None;
    }
    Some(unsafe { &*buffer.datas })
}

unsafe extern "C" fn on_param_changed(data: *mut c_void, id: u32, param: *const sys::spa_pod) {
    let Some(sink) = (unsafe { data.cast::<Sink>().as_mut() }) else {
        return;
    };
    if id != ParamType::Format.as_raw() || param.is_null() {
        return;
    }
    let pod = unsafe { Pod::from_raw(param) };
    let _ = sink.format.parse(pod);
}

unsafe extern "C" fn on_process(data: *mut c_void) {
    let Some(sink) = (unsafe { data.cast::<Sink>().as_mut() }) else {
        return;
    };
    sink.read();
}

struct Resources {
    api: Api,
    _library: Library,
    main_loop: *mut c_void,
    context: *mut c_void,
    core: *mut c_void,
    stream: *mut c_void,
}

impl Drop for Resources {
    fn drop(&mut self) {
        unsafe {
            if !self.stream.is_null() {
                (self.api.stream_destroy)(self.stream);
            }
            if !self.context.is_null() {
                (self.api.context_destroy)(self.context);
            }
            if !self.main_loop.is_null() {
                (self.api.main_loop_destroy)(self.main_loop);
            }
            (self.api.deinit)();
        }
    }
}

pub(crate) struct Reader {
    resources: Resources,
    _events: Box<StreamEvents>,
    _hook: Box<sys::spa_hook>,
    _sink: Box<Sink>,
}

impl Reader {
    pub(crate) fn start(
        fd: OwnedFd,
        node: u32,
        latest: Arc<Mutex<Option<Frame>>>,
    ) -> Result<Self, DriverError> {
        let library = load()?;
        let api = Api::load(&library)?;
        let mut resources = Resources {
            api,
            _library: library,
            main_loop: ptr::null_mut(),
            context: ptr::null_mut(),
            core: ptr::null_mut(),
            stream: ptr::null_mut(),
        };
        unsafe { (api.init)(ptr::null_mut(), ptr::null_mut()) };
        resources.main_loop = unsafe { (api.main_loop_new)(ptr::null()) };
        if resources.main_loop.is_null() {
            return Err(failed("could not open a PipeWire loop"));
        }
        let pw_loop = unsafe { (api.main_loop_get_loop)(resources.main_loop) };
        resources.context = unsafe { (api.context_new)(pw_loop, ptr::null_mut(), 0) };
        if resources.context.is_null() {
            return Err(failed("could not open a PipeWire context"));
        }
        resources.core = unsafe {
            (api.context_connect_fd)(resources.context, fd.into_raw_fd(), ptr::null_mut(), 0)
        };
        if resources.core.is_null() {
            return Err(failed("could not connect to the screen share"));
        }
        resources.stream =
            unsafe { (api.stream_new)(resources.core, c"kiko-capture".as_ptr(), properties(&api)) };
        if resources.stream.is_null() {
            return Err(failed("could not create the capture stream"));
        }
        let sink = Box::new(Sink {
            api,
            stream: resources.stream,
            format: VideoInfoRaw::default(),
            latest,
        });
        let mut events: StreamEvents = unsafe { std::mem::zeroed() };
        events.version = STREAM_EVENTS_VERSION;
        events.param_changed = Some(on_param_changed);
        events.process = Some(on_process);
        let events = Box::new(events);
        let mut hook: Box<sys::spa_hook> = Box::new(unsafe { std::mem::zeroed() });
        unsafe {
            (api.stream_add_listener)(
                resources.stream,
                &mut *hook,
                ptr::from_ref(&*events),
                (&*sink as *const Sink).cast_mut().cast(),
            )
        };
        let pod = format()?;
        let params: [*const sys::spa_pod; 1] = [pod.as_raw_ptr()];
        let connected = unsafe {
            (api.stream_connect)(
                resources.stream,
                DIRECTION_INPUT,
                node,
                STREAM_FLAG_AUTOCONNECT | STREAM_FLAG_MAP_BUFFERS,
                params.as_ptr(),
                1,
            )
        };
        if connected < 0 {
            return Err(failed(format!(
                "could not read the screen share: {connected}"
            )));
        }
        Ok(Self {
            resources,
            _events: events,
            _hook: hook,
            _sink: sink,
        })
    }

    pub(crate) fn run(&self) {
        unsafe { (self.resources.api.main_loop_run)(self.resources.main_loop) };
    }
}

fn load() -> Result<Library, DriverError> {
    unsafe { Library::new(LIBRARY) }.map_err(|error| {
        unsupported(format!(
            "Wayland image capture needs {LIBRARY}, which is not installed: {error}"
        ))
    })
}

fn missing(error: libloading::Error) -> DriverError {
    unsupported(format!(
        "{LIBRARY} is missing a function kiko needs: {error}"
    ))
}

fn properties(api: &Api) -> *mut c_void {
    let items = [
        sys::spa_dict_item {
            key: c"media.type".as_ptr(),
            value: c"Video".as_ptr(),
        },
        sys::spa_dict_item {
            key: c"media.category".as_ptr(),
            value: c"Capture".as_ptr(),
        },
        sys::spa_dict_item {
            key: c"media.role".as_ptr(),
            value: c"Screen".as_ptr(),
        },
    ];
    let dict = sys::spa_dict {
        flags: 0,
        n_items: items.len() as u32,
        items: items.as_ptr(),
    };
    unsafe { (api.properties_new_dict)(&dict) }
}

fn format() -> Result<&'static Pod, DriverError> {
    use libspa::param::format::{FormatProperties, MediaSubtype, MediaType};
    use libspa::pod::property;
    use libspa::utils::{Fraction, SpaTypes};

    let object = libspa::pod::object!(
        SpaTypes::ObjectParamFormat,
        ParamType::EnumFormat,
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
    let bytes = libspa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &libspa::pod::Value::Object(object),
    )
    .map_err(|error| failed(format!("could not describe the capture format: {error}")))?
    .0
    .into_inner();
    Pod::from_bytes(Box::leak(bytes.into_boxed_slice()))
        .ok_or_else(|| failed("the capture format is not a PipeWire pod"))
}
