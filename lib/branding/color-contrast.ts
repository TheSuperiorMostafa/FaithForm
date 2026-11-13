import { normalizeHexColor } from "@/lib/giving/branding";

function luminance(color: string): number {
  const hex=normalizeHexColor(color) ?? "#FFFFFF";
  const channels=[1,3,5].map(index=>{
    const value=parseInt(hex.slice(index,index+2),16)/255;
    return value<=0.04045 ? value/12.92 : ((value+0.055)/1.055)**2.4;
  });
  return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
}

export function colorContrast(a: string,b: string): number {
  const first=luminance(a),second=luminance(b);
  return (Math.max(first,second)+0.05)/(Math.min(first,second)+0.05);
}

/** Either black or white meets AA for normal text on any opaque RGB color. */
export function readableColorText(background: string): string {
  return colorContrast(background,"#000000")>=colorContrast(background,"#FFFFFF") ? "#000000" : "#FFFFFF";
}
