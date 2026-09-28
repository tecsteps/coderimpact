export function slugify(text) {
  return text.trim().toLowerCase().split(" ").join("_");
}
