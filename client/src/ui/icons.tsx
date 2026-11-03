/* Line icons, 24×24, drawn with currentColor. */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P): P => ({ width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...p });

export const IGrid = (p: P) => (<svg {...base(p)}><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></svg>);
export const IUpload = (p: P) => (<svg {...base(p)}><path d="M12 16V4.5M7.5 9 12 4.5 16.5 9M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5" /></svg>);
export const IDownload = (p: P) => (<svg {...base(p)}><path d="M12 4.5V16M7.5 11.5 12 16l4.5-4.5M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5" /></svg>);
export const IUser = (p: P) => (<svg {...base(p)}><circle cx="12" cy="8.5" r="3.7" /><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" /></svg>);
export const IX = (p: P) => (<svg {...base(p)}><path d="m6.5 6.5 11 11M17.5 6.5l-11 11" /></svg>);
export const IChevL = (p: P) => (<svg {...base(p)}><path d="m14.5 6-6 6 6 6" /></svg>);
export const IChevR = (p: P) => (<svg {...base(p)}><path d="m9.5 6 6 6-6 6" /></svg>);
export const ISearch = (p: P) => (<svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></svg>);
export const ILink = (p: P) => (<svg {...base(p)}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>);
export const IArrowUR = (p: P) => (<svg {...base(p)}><path d="M7.5 16.5 16.5 7.5M9 7.5h7.5V15" /></svg>);
export const IPlay = (p: P) => (<svg {...base(p)} fill="currentColor" stroke="none"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" /></svg>);
export const IImage = (p: P) => (<svg {...base(p)}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.8" /><path d="m4 17.5 4.6-4.6a1.5 1.5 0 0 1 2.1 0l5.8 5.8M14 15l1.6-1.6a1.5 1.5 0 0 1 2.1 0L20.5 16" /></svg>);
export const IVideo = (p: P) => (<svg {...base(p)}><rect x="3.5" y="5.5" width="12.5" height="13" rx="3" /><path d="m16 10.2 3.4-2.1a.7.7 0 0 1 1.1.6v6.6a.7.7 0 0 1-1.1.6L16 13.8" /></svg>);
export const IDoc = (p: P) => (<svg {...base(p)}><path d="M6.5 3.5h7l4 4v12a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" /><path d="M13.5 3.5v4h4M9 12.5h6M9 16h4" /></svg>);
export const IMusic = (p: P) => (<svg {...base(p)}><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></svg>);
export const ISun = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></svg>);
export const IMoon = (p: P) => (<svg {...base(p)}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>);
export const IAuto = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="8" /><path d="M12 4v16a8 8 0 0 0 0-16z" fill="currentColor" /></svg>);
export const ICheck = (p: P) => (<svg {...base(p)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>);
export const IInfo = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.1" /></svg>);
export const ISpark = (p: P) => (<svg {...base(p)}><path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14l-6.7-2 6.7-2z" /></svg>);
export const IFolder = (p: P) => (<svg {...base(p)}><path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2h7.4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg>);
export const ISignOut = (p: P) => (<svg {...base(p)}><path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16.5 5.5 12 10 7.5M5.5 12h10" /></svg>);
