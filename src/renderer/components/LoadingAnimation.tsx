import { useEffect, useState } from "react";
import type { LoadingMediaResponse } from "../../shared/ipc";

type LoadingAnimationProps = {
  label: string;
  className?: string;
  mediaClassName?: string;
};

const fallbackLoadingMedia: LoadingMediaResponse = {
  animationUrl: new URL(
    "../../../brand/starship animation-1.mp4",
    import.meta.url
  ).href,
  posterUrl: new URL("../../../brand/starship.png", import.meta.url).href
};
const animationImageUrl = new URL(
  "../../../brand/starship-animation.webp",
  import.meta.url
).href;

let loadingMediaPromise: Promise<LoadingMediaResponse> | null = null;

const getLoadingMedia = (): Promise<LoadingMediaResponse> => {
  if (typeof window === "undefined" || !window.starship?.assets) {
    return Promise.resolve(fallbackLoadingMedia);
  }

  loadingMediaPromise ??= window.starship.assets
    .getLoadingMedia()
    .catch(() => fallbackLoadingMedia);

  return loadingMediaPromise;
};

export const LoadingAnimation = ({
  label,
  className = "",
  mediaClassName = "h-40 w-64 max-w-[70vw]"
}: LoadingAnimationProps): JSX.Element => {
  const [media, setMedia] = useState<LoadingMediaResponse | null>(null);
  const [animationFailed, setAnimationFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getLoadingMedia().then((nextMedia) => {
      if (cancelled) {
        return;
      }

      setMedia(nextMedia);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      role="status"
      aria-label={label}
      className={`flex min-h-0 items-center justify-center ${className}`}
    >
      <div className={`relative shrink-0 ${mediaClassName}`}>
        <img
          aria-hidden="true"
          alt=""
          src={
            animationFailed
              ? media?.posterUrl ?? fallbackLoadingMedia.posterUrl
              : animationImageUrl
          }
          onError={() => setAnimationFailed(true)}
          className="absolute inset-0 h-full w-full object-contain"
        />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
};
