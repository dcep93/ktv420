const MIN_VOLUME_DECIBELS = -64;
const MAX_VOLUME_DECIBELS = 16;
const MIN_VOLUME_SLIDER_VALUE = 0;
const UNITY_VOLUME_SLIDER_VALUE = 1;
const MAX_VOLUME_SLIDER_VALUE = 2;

export function getLogarithmicVolumeGain(volume: number) {
  const clampedVolume = Math.min(
    MAX_VOLUME_SLIDER_VALUE,
    Math.max(MIN_VOLUME_SLIDER_VALUE, volume)
  );

  if (clampedVolume === MIN_VOLUME_SLIDER_VALUE) {
    return 0;
  }

  const decibels =
    clampedVolume <= UNITY_VOLUME_SLIDER_VALUE
      ? MIN_VOLUME_DECIBELS * (UNITY_VOLUME_SLIDER_VALUE - clampedVolume)
      : MAX_VOLUME_DECIBELS * (clampedVolume - UNITY_VOLUME_SLIDER_VALUE);

  return 10 ** (decibels / 20);
}
