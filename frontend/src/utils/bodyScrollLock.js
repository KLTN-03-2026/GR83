let lockCount = 0;
let previousOverflow = '';

export function acquireBodyScrollLock() {
  if (typeof document === 'undefined') {
    return () => {};
  }

  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
  }

  lockCount += 1;
  document.body.style.overflow = 'hidden';

  let released = false;

  return () => {
    if (released || typeof document === 'undefined') {
      return;
    }

    released = true;
    lockCount = Math.max(0, lockCount - 1);

    if (lockCount === 0) {
      document.body.style.overflow = previousOverflow;
    }
  };
}

  export function resetBodyScrollLock() {
    if (typeof document === 'undefined') {
      return;
    }

    lockCount = 0;
    document.body.style.overflow = previousOverflow || '';
  }