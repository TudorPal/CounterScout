/** Fire grenades share one UI category, including CT incendiaries. */
export const utilityCategory = (type: string) => type === 'incgrenade' || type === 'incendiary' ? 'molotov' : type;
export function matchesUtilityType(type: string, selected: string) {
  return selected === 'all' || utilityCategory(type) === selected;
}
