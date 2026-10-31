// Views by data type (React components). A pack registers one for each of its
// own data types; the Inspector picks the first whose is() accepts the value.
//   Component props: { value, history }   (history = { frames, count, max } or undefined)
export const DATA_VIEWS = [];

export function registerDataView(view) {
  if (!DATA_VIEWS.some((v) => v.name === view.name)) DATA_VIEWS.push(view);
}
