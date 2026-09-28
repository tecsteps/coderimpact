export function formatPrice(cents) {
  const euros = cents / 100;
  return `${euros.toFixed(2)} EUR`;
}

export const sumOf = (values) => {
  let acc = 0;
  for (const v of values) {
    acc += v;
  }
  return acc;
};

export function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, "-");
}
