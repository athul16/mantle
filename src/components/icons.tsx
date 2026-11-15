/**
 * Icon set from the product prototype: 24x24 stroke icons drawn with the .i
 * class in src/app/mantle.css (16px; .i-sm 14px, .i-lg 20px, .i-xl 28px).
 */
const PATHS = {
  "check": "<path d=\"M4 12l5 5L20 6\"/>",
  "x": "<path d=\"M6 6l12 12M18 6L6 18\"/>",
  "lock": "<rect x=\"5\" y=\"11\" width=\"14\" height=\"10\" rx=\"2\"/><path d=\"M8 11V7a4 4 0 0 1 8 0v4\"/>",
  "mail": "<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\"/><path d=\"M3 7l9 6 9-6\"/>",
  "clock": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>",
  "video": "<rect x=\"3\" y=\"6\" width=\"13\" height=\"12\" rx=\"2\"/><path d=\"M16 10l5-3v10l-5-3\"/>",
  "videoOff": "<path d=\"M3 3l18 18\"/><path d=\"M16 10l5-3v10l-3-1.8M14 18H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1\"/>",
  "monitor": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"12\" rx=\"2\"/><path d=\"M8 20h8M12 16v4\"/>",
  "alert": "<path d=\"M12 3l9.5 17h-19z\"/><path d=\"M12 10v4M12 17.5v.01\"/>",
  "checkc": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M8 12l3 3 5-6\"/>",
  "xc": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M9 9l6 6M15 9l-6 6\"/>",
  "circle": "<circle cx=\"12\" cy=\"12\" r=\"9\"/>",
  "arrowR": "<path d=\"M5 12h14M13 6l6 6-6 6\"/>",
  "chevL": "<path d=\"M15 6l-6 6 6 6\"/>",
  "chevR": "<path d=\"M9 6l6 6-6 6\"/>",
  "file": "<path d=\"M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z\"/><path d=\"M14 3v5h5\"/>",
  "calc": "<rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"2\"/><path d=\"M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01\"/>",
  "send": "<path d=\"M21 3L10 14M21 3l-7 18-4-7-7-4z\"/>",
  "reply": "<path d=\"M9 14L4 9l5-5\"/><path d=\"M4 9h11a5 5 0 0 1 5 5v6\"/>",
  "info": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v5M12 8v.01\"/>",
  "refresh": "<path d=\"M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5\"/>",
  "laptop": "<rect x=\"5\" y=\"5\" width=\"14\" height=\"10\" rx=\"1\"/><path d=\"M2 19h20\"/>",
  "camera": "<rect x=\"3\" y=\"6\" width=\"18\" height=\"14\" rx=\"2\"/><circle cx=\"12\" cy=\"13\" r=\"3.5\"/><path d=\"M8 6l1.5-2h5L16 6\"/>",
  "plus": "<path d=\"M12 5v14M5 12h14\"/>",
  "grid": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 10h18M3 15h18M9 4v16\"/>",
  "play": "<path d=\"M7 4l12 8-12 8z\"/>",
  "wifiOff": "<path d=\"M3 3l18 18M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M14.5 10.2a10 10 0 0 1 4.5 2.3M12 19.5v.01\"/>",
  "wifi": "<path d=\"M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 19.5v.01\"/>",
  "copy": "<rect x=\"9\" y=\"9\" width=\"11\" height=\"11\" rx=\"2\"/><path d=\"M5 15V5a1 1 0 0 1 1-1h9\"/>",
  "activity": "<path d=\"M3 12h4l3-8 4 16 3-8h4\"/>",
  "user": "<circle cx=\"9\" cy=\"8\" r=\"4\"/><path d=\"M2 21a7 7 0 0 1 14 0\"/>",
  "trash": "<path d=\"M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14\"/>",
  "maximize": "<path d=\"M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5\"/>",
  "pause": "<path d=\"M9 5v14M15 5v14\"/>",
  "sliders": "<path d=\"M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12\"/><circle cx=\"16\" cy=\"6\" r=\"2\"/><circle cx=\"10\" cy=\"12\" r=\"2\"/><circle cx=\"18\" cy=\"18\" r=\"2\"/>",
  "paperclip": "<path d=\"M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7\"/>",
  "ext": "<path d=\"M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5\"/>",
  "eye": "<path d=\"M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  "up": "<path d=\"M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.3 20H7\"/>",
  "down": "<path d=\"M17 13V4h3v9zM17 13l-4 7a2 2 0 0 1-2-2v-4H5.5a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 6.7 4H17\"/>",
  "unsure": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17v.01\"/>",
  "flag": "<path d=\"M5 21V4M5 4h11l-2 4 2 4H5\"/>",
  "sparkle": "<path d=\"M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z\"/>",
  "download": "<path d=\"M12 4v12M7 11l5 5 5-5M4 20h16\"/>",
  "ban": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M5.6 5.6l12.8 12.8\"/>",
  "chevD": "<path d=\"M6 9l6 6 6-6\"/>",
  "search": "<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M20 20l-3.5-3.5\"/>",
  "help": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17v.01\"/>",
  "more": "<path d=\"M5 12h.01M12 12h.01M19 12h.01\"/>",
  "upload": "<path d=\"M12 20V8M7 13l5-5 5 5M4 4h16\"/>",
  "link": "<path d=\"M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1\"/><path d=\"M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1\"/>",
  "phone": "<rect x=\"7\" y=\"3\" width=\"10\" height=\"18\" rx=\"2\"/><path d=\"M11 18h2\"/>",
  "shield": "<path d=\"M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z\"/>",
  "bell": "<path d=\"M6 16V11a6 6 0 0 1 12 0v5l2 2H4z\"/><path d=\"M10 20a2 2 0 0 0 4 0\"/>",
  "users": "<circle cx=\"9\" cy=\"8\" r=\"4\"/><path d=\"M2 21a7 7 0 0 1 14 0\"/><path d=\"M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3\"/>",
  "userPlus": "<circle cx=\"9\" cy=\"8\" r=\"4\"/><path d=\"M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6\"/>",
  "filter": "<path d=\"M3 5h18l-7 8v6l-4 2v-8z\"/>",
  "list": "<path d=\"M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01\"/>",
  "columns": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M9 4v16M15 4v16\"/>",
  "arrowDown": "<path d=\"M12 5v14M6 13l6 6 6-6\"/>",
  "logout": "<path d=\"M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3\"/>",
  "settings": "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z\"/>",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className, label }: { name: IconName; className?: string; label?: string }) {
  return (
    <svg
      className={className ? `i ${className}` : "i"}
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
