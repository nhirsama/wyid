/** Next's catch-all parameters may retain percent-encoded reserved characters. */
export function decodeAccountSegments(path: string[]) {
  return path.map(segment => {
    const value = decodeURIComponent(segment);
    if (!value || value.length > 2048 || value === "." || value === ".." || /[\/\\\u0000-\u001f\u007f]/.test(value)) throw new Error("Invalid account route");
    return value;
  });
}
