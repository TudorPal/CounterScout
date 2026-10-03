/** Keep portalled pickers inside the viewport; flip above when space is tight. */
export function popoverPosition(rect: {left:number;top:number;bottom:number;width:number}, viewport: {width:number;height:number}, desiredHeight:number, minWidth=0) {
  const margin=8, gap=6;
  const below=Math.max(0,viewport.height-rect.bottom-margin-gap);
  const above=Math.max(0,rect.top-margin-gap);
  const useBelow=below>=Math.min(desiredHeight,180) || below>=above;
  const height=Math.min(desiredHeight,useBelow?below:above);
  const width=Math.min(Math.max(rect.width,minWidth),Math.max(0,viewport.width-margin*2));
  return {left:Math.max(margin,Math.min(rect.left,viewport.width-width-margin)),
    top:useBelow?rect.bottom+gap:Math.max(margin,rect.top-height-gap),width,height};
}
