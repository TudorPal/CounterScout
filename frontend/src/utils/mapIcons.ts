/** Cache's official game badge is an SVG; existing badges are PNG exports. */
export const mapIconPath = (map: string) => `/icons/maps/${map}.${map === "de_cache" ? "svg" : "png"}`;
