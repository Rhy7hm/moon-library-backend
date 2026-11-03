/* Line icons in the spirit of SF Symbols: 24-unit grid, 1.7 stroke, round caps. */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const IHome = (p: P) => (<svg {...base(p)}><path d="M3.5 10.5 12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5A1.5 1.5 0 0 1 3.5 19z" /></svg>);
export const IFolder = (p: P) => (<svg {...base(p)}><path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2h7.4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg>);
export const IClock = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>);
export const ILock = (p: P) => (<svg {...base(p)}><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>);
export const IUnlock = (p: P) => (<svg {...base(p)}><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2" /></svg>);
export const ITrash = (p: P) => (<svg {...base(p)}><path d="M4.5 7h15M10 4h4M6.5 7l.8 11.6A1.5 1.5 0 0 0 8.8 20h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v5M14 11v5" /></svg>);
export const IChart = (p: P) => (<svg {...base(p)}><path d="M4 20h16M7 16v-4M12 16V8M17 16v-7" /></svg>);
export const IList = (p: P) => (<svg {...base(p)}><path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" /></svg>);
export const IGrid = (p: P) => (<svg {...base(p)}><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></svg>);
export const IUsers = (p: P) => (<svg {...base(p)}><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M16 5.6a3.2 3.2 0 0 1 0 6.1M17.5 14.2a5.5 5.5 0 0 1 3 5.3" /></svg>);
export const IGear = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.1-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2.1 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.1 1.2L10 21h4l.5-2.6a7 7 0 0 0 2.1-1.2l2.3.9 2-3.4-2-1.5A7 7 0 0 0 19 12z" /></svg>);
export const IPulse = (p: P) => (<svg {...base(p)}><path d="M3 12h4l2.5-6 5 12L17 12h4" /></svg>);
export const ISearch = (p: P) => (<svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>);
export const IUpload = (p: P) => (<svg {...base(p)}><path d="M12 16V4.5M7.5 9 12 4.5 16.5 9M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5" /></svg>);
export const IDownload = (p: P) => (<svg {...base(p)}><path d="M12 4.5V16M7.5 11.5 12 16l4.5-4.5M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5" /></svg>);
export const IPlus = (p: P) => (<svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>);
export const IX = (p: P) => (<svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>);
export const ICheck = (p: P) => (<svg {...base(p)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>);
export const ICopy = (p: P) => (<svg {...base(p)}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5" /></svg>);
export const IChevR = (p: P) => (<svg {...base(p)}><path d="m9.5 6 6 6-6 6" /></svg>);
export const IChevD = (p: P) => (<svg {...base(p)}><path d="m6 9.5 6 6 6-6" /></svg>);
export const IMore = (p: P) => (<svg {...base(p)}><circle cx="6" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="18" cy="12" r="1" fill="currentColor" /></svg>);
export const IMove = (p: P) => (<svg {...base(p)}><path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2h7.4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M9.5 13.5h5M12.5 11l2.5 2.5-2.5 2.5" /></svg>);
export const IPencil = (p: P) => (<svg {...base(p)}><path d="M14.5 5.5l4 4M4.5 19.5l1-4.5L15.8 4.7a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L9 18.5z" /></svg>);
export const IRestore = (p: P) => (<svg {...base(p)}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" /></svg>);
export const IReplace = (p: P) => (<svg {...base(p)}><path d="M4.5 9a7.5 7.5 0 0 1 13.4-2.6M19.5 4.5v4h-4M19.5 15a7.5 7.5 0 0 1-13.4 2.6M4.5 19.5v-4h4" /></svg>);
export const ISignOut = (p: P) => (<svg {...base(p)}><path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16.5 5.5 12 10 7.5M5.5 12H15" /></svg>);
export const IImage = (p: P) => (<svg {...base(p)}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 4.5-4.5 3.5 3.5 3-3 5 5" /></svg>);
export const IVideo = (p: P) => (<svg {...base(p)}><rect x="3.5" y="6" width="12.5" height="12" rx="2.5" /><path d="m16 10.5 4.5-2.5v8L16 13.5" /></svg>);
export const IDoc = (p: P) => (<svg {...base(p)}><path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5z" /><path d="M13.5 3.5v5h5M9 13h6M9 16.5h4" /></svg>);
export const IPen = (p: P) => (<svg {...base(p)}><path d="M12 3.5 18.5 10 12 20.5 5.5 10z" /><circle cx="12" cy="11.5" r="1.6" /><path d="M12 3.5v6.4" /></svg>);
export const IAudio = (p: P) => (<svg {...base(p)}><path d="M9 17.5V6.5l10-2v11" /><circle cx="6.5" cy="17.5" r="2.5" /><circle cx="16.5" cy="15.5" r="2.5" /></svg>);
export const IFile = (p: P) => (<svg {...base(p)}><path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5z" /><path d="M13.5 3.5v5h5" /></svg>);
export const IKey = (p: P) => (<svg {...base(p)}><circle cx="8" cy="14.5" r="4" /><path d="m11 11.5 8-8M16 6.5l2.5 2.5M14 8.5l2 2" /></svg>);
export const IDevice = (p: P) => (<svg {...base(p)}><rect x="3.5" y="5" width="17" height="11" rx="2" /><path d="M8 20h8M12 16v4" /></svg>);
export const ISparkles = (p: P) => (<svg {...base(p)}><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6zM18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></svg>);
export const IBriefcase = (p: P) => (<svg {...base(p)}><rect x="3.5" y="7" width="17" height="12.5" rx="2.5" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17" /></svg>);
export const ILink = (p: P) => (<svg {...base(p)}><path d="M10 14a4 4 0 0 0 5.7.3l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" /><path d="M14 10a4 4 0 0 0-5.7-.3l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" /></svg>);
export const IShare = (p: P) => (<svg {...base(p)}><path d="M12 15V4M8 7.5 12 4l4 3.5" /><path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H16" /></svg>);
export const IExternal = (p: P) => (<svg {...base(p)}><path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V9a1.5 1.5 0 0 1 1.5-1.5h4" /></svg>);
export const ISun = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="3.8" /><path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3" /></svg>);
export const IMoonLine = (p: P) => (<svg {...base(p)}><path d="M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z" /></svg>);
export const IAuto = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></svg>);
export const IMoon = (p: P) => (<svg {...base(p)} fill="currentColor" stroke="none"><path d="M14.8 3.2a8.8 8.8 0 1 0 6 13.4 7.4 7.4 0 0 1-6-13.4z" /></svg>);
export const IPin = (p: P) => (<svg {...base(p)}><path d="M9.5 3.5h5l-.8 5.2 3.3 3.3v1.5H7v-1.5l3.3-3.3z" /><path d="M12 13.5v7" /></svg>);
export const IPinOff = (p: P) => (<svg {...base(p)}><path d="M9.5 3.5h5l-.8 5.2 3.3 3.3v1.5H7v-1.5l3.3-3.3z" /><path d="M12 13.5v7M4 4l16 16" /></svg>);
export const IGrip = (p: P) => (<svg {...base(p)} fill="currentColor" stroke="none"><circle cx="9" cy="6.5" r="1.4" /><circle cx="15" cy="6.5" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="17.5" r="1.4" /><circle cx="15" cy="17.5" r="1.4" /></svg>);
export const ITag = (p: P) => (<svg {...base(p)}><path d="M3.5 12.2V5a1.5 1.5 0 0 1 1.5-1.5h7.2a1.5 1.5 0 0 1 1 .44l7.4 7.4a1.5 1.5 0 0 1 0 2.12l-7.2 7.2a1.5 1.5 0 0 1-2.12 0l-7.4-7.4a1.5 1.5 0 0 1-.44-1z" /><circle cx="8.3" cy="8.3" r="1.4" /></svg>);
