import { useState } from 'react';

export function useToggle(initialValue = false) {
  const [value, setValue] = useState(initialValue);

  const on = () => setValue(true);
  const off = () => setValue(false);
  const toggle = () => setValue((current) => !current);

  return { value, setValue, on, off, toggle };
}
