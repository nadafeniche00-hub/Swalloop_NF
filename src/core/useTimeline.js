import { useEffect, useState } from 'react';

// Playback state for a loop's history ({ frames, count, max } from Loop End).
//   iteration  0 .. max   (max is the Loop End limit; the run may stop earlier at count)
//   frame      index into the stored frames (they may be thinned)
// Play replays the whole run from the start up to the maximum.
export function useTimeline(history) {
  const frames = history?.frames;
  const last = frames ? frames.length - 1 : 0;
  const count = history?.count ?? last;
  const max = Math.max(history?.max ?? count, 1);
  const [iter, setIter] = useState(null); // null shows the final result
  const [playing, setPlaying] = useState(false);
  const shownIter = iter ?? count;
  const frame = shownIter >= count ? last : Math.round((shownIter / Math.max(count, 1)) * last);

  useEffect(() => {
    if (!playing || !frames) return undefined;
    const inc = Math.max(1, Math.ceil(max / 150));
    let i = 0;
    let t0 = performance.now();
    let raf;
    setIter(0);
    const step = (t) => {
      if (t - t0 > 40) {
        t0 = t;
        i += inc;
        if (i >= max) {
          setIter(null);
          setPlaying(false);
          return;
        }
        setIter(i);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, frames, max]);

  return { frames, last, count, max, shownIter, frame, iter, setIter, playing, setPlaying };
}
