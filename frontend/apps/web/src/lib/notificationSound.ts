import { versionedPublicAssetPath } from '@/lib/publicAsset';

const NOTIFICATION_SOUND_FILES = {
	call: versionedPublicAssetPath('/sounds/call.mp3'),
	dm: versionedPublicAssetPath('/sounds/dm.mp3'),
	message: versionedPublicAssetPath('/sounds/message.mp3'),
} as const;

export type NotificationSoundName = keyof typeof NOTIFICATION_SOUND_FILES;
export type NotificationSoundState = 'unknown' | 'ready' | 'blocked';

export const NOTIFICATION_SOUND_STATE_CHANGE_EVENT = 'notification-sound-statechange';

const notificationSoundPool = new Map<NotificationSoundName, HTMLAudioElement>();

let notificationSoundState: NotificationSoundState = 'unknown';

function dispatchNotificationSoundState(nextState: NotificationSoundState) {
	notificationSoundState = nextState;

	if (typeof window === 'undefined') {
		return;
	}

	window.dispatchEvent(
		new CustomEvent<NotificationSoundState>(NOTIFICATION_SOUND_STATE_CHANGE_EVENT, {
			detail: nextState,
		}),
	);
}

function getNotificationAudio(name: NotificationSoundName): HTMLAudioElement {
	const existingAudio = notificationSoundPool.get(name);
	if (existingAudio) {
		return existingAudio;
	}

	const audio = new Audio(NOTIFICATION_SOUND_FILES[name]);
	audio.preload = 'auto';
	audio.setAttribute('playsinline', 'true');
	if (name !== 'call') {
		audio.volume = 0.5;
	}
	notificationSoundPool.set(name, audio);
	return audio;
}

export function getNotificationSoundState(): NotificationSoundState {
	return notificationSoundState;
}

export function browserNeedsExplicitSoundActivation(): boolean {
	if (typeof navigator === 'undefined') {
		return false;
	}

	const userAgent = navigator.userAgent;
	return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(userAgent);
}

export async function warmupNotificationSounds(): Promise<boolean> {
	if (typeof Audio === 'undefined') {
		return false;
	}

	try {
		await Promise.all(
			(Object.keys(NOTIFICATION_SOUND_FILES) as NotificationSoundName[]).map(
				async (name) => {
					const audio = getNotificationAudio(name);
					const previousMuted = audio.muted;
					const previousVolume = audio.volume;

					audio.muted = true;
					audio.volume = 0;
					audio.currentTime = 0;
					await audio.play();
					audio.pause();
					audio.currentTime = 0;
					audio.muted = previousMuted;
					audio.volume = previousVolume;
				},
			),
		);

		dispatchNotificationSoundState('ready');
		return true;
	} catch (error) {
		console.warn('[notificationSound] Failed to warm up notification audio:', error);
		dispatchNotificationSoundState('blocked');
		return false;
	}
}

export async function playNotificationSound(name: NotificationSoundName): Promise<boolean> {
	if (typeof Audio === 'undefined') {
		return false;
	}

	try {
		const audio = getNotificationAudio(name);
		audio.pause();
		audio.currentTime = 0;
		audio.muted = false;
		await audio.play();
		dispatchNotificationSoundState('ready');
		return true;
	} catch (error) {
		console.warn('[notificationSound] Failed to play notification sound:', error);
		dispatchNotificationSoundState('blocked');
		return false;
	}
}