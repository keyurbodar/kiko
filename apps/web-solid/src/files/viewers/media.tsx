import { AudioBubble } from "../media/player/AudioBubble"
import { VideoPlayer } from "../media/player/VideoPlayer"

/* Audio and video files play in kiko's own players. */

export function AudioView(props: { src: string; title: string }) {
	return (
		<div class="fv-center" data-component="file-audio">
			<div class="fv-audio">
				<AudioBubble src={props.src} title={props.title} />
			</div>
		</div>
	)
}

export function VideoView(props: { src: string; title: string }) {
	return (
		<div class="fv-center" data-component="file-video">
			<VideoPlayer src={props.src} title={props.title} class="fv-video" />
		</div>
	)
}
