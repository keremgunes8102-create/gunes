// Satır içi SVG ikon seti (harici bağımlılık yok). 24x24, 1.75 çizgi kalınlığı.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20, rest: SVGProps<SVGSVGElement>) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  ...rest,
});

const make = (paths: React.ReactNode) =>
  function Icon({ size, ...rest }: P) {
    return <svg {...base(size, rest)}>{paths}</svg>;
  };

export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconPin = make(<><path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>);
export const IconCalendar = make(<><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>);
export const IconClock = make(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const IconHeart = make(<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z" />);
export function IconHeartFilled({ size, ...rest }: P) {
  return (
    <svg {...base(size, rest)} fill="currentColor">
      <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z" />
    </svg>
  );
}
export const IconStar = make(<path d="m12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6L12 16.6l-5 2.7.9-5.6-4-4 5.6-.8L12 3.8Z" />);
export function IconStarFilled({ size, ...rest }: P) {
  return (
    <svg {...base(size, rest)} fill="currentColor" strokeWidth={1}>
      <path d="m12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6L12 16.6l-5 2.7.9-5.6-4-4 5.6-.8L12 3.8Z" />
    </svg>
  );
}
export const IconCheck = make(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconCheckCircle = make(<><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.3 2.4 2.4 4.7-5" /></>);
export const IconX = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconChevronRight = make(<path d="m9.5 6 6 6-6 6" />);
export const IconChevronLeft = make(<path d="m14.5 6-6 6 6 6" />);
export const IconChevronDown = make(<path d="m6 9.5 6 6 6-6" />);
export const IconMenu = make(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconUser = make(<><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.3-3.6 4.2-5.4 7.5-5.4s6.2 1.8 7.5 5.4" /></>);
export const IconUsers = make(<><circle cx="9" cy="9" r="3.3" /><path d="M3 19.5c.9-3 3.2-4.6 6-4.6s5.1 1.6 6 4.6M15.5 5.8a3.3 3.3 0 0 1 0 6.4M17.5 14.9c1.8.5 3 1.9 3.5 4.6" /></>);
export const IconBell = make(<><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>);
export const IconScissors = make(<><circle cx="6.5" cy="7" r="2.5" /><circle cx="6.5" cy="17" r="2.5" /><path d="M8.6 8.4 20 17M8.6 15.6 20 7" /></>);
export const IconSparkle = make(<path d="M12 3.5c.6 4.3 2.2 5.9 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5ZM18.5 15.5c.3 1.8.9 2.4 2.7 2.7-1.8.3-2.4.9-2.7 2.7-.3-1.8-.9-2.4-2.7-2.7 1.8-.3 2.4-.9 2.7-2.7Z" />);
export const IconComb = make(<><path d="M4 9.5h16v3H4z" /><path d="M5.5 12.5V18M8 12.5V18M10.5 12.5V18M13 12.5V18M15.5 12.5V18M18 12.5V18" /></>);
export const IconChair = make(<><path d="M7 4.5h10a1.5 1.5 0 0 1 1.5 1.5v5.5h-13V6A1.5 1.5 0 0 1 7 4.5Z" /><path d="M4.5 11.5h15v3h-15zM8 14.5 7 20M16 14.5l1 5.5M12 14.5V20" /></>);
export const IconPhone = make(<path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 6.2 6.2l1.3-2 4 1.5v3A2 2 0 0 1 18.5 20 15 15 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z" />);
export const IconShare = make(<><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" /><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5" /></>);
export const IconShield = make(<><path d="M12 3.5 19 6v5.5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6l7-2.5Z" /><path d="m9 12 2.2 2.2L15.5 10" /></>);
export const IconGrid = make(<><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>);
export const IconList = make(<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />);
export const IconChart = make(<path d="M4 20V10M10 20V4M16 20v-7M20.5 20h-17" />);
export const IconSettings = make(<><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.3 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" /></>);
export const IconStore = make(<><path d="M4 9.5 5.5 4.5h13L20 9.5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" /><path d="M5.5 11.5v8.5h13v-8.5M10 20v-4.5h4V20" /></>);
export const IconTag = make(<><path d="M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.2 8.2a1.5 1.5 0 0 1 0 2.1l-6.2 6.2a1.5 1.5 0 0 1-2.1 0l-8.7-7.7Z" /><circle cx="8" cy="8" r="1.4" /></>);
export const IconMessage = make(<path d="M5 18.5 3.5 21V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10.5a2 2 0 0 1-2 2H5Z" />);
export const IconCard = make(<><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18M7 15h3" /></>);
export const IconLogout = make(<><path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14" /><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" /></>);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconTrash = make(<><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /></>);
export const IconEdit = make(<><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>);
export const IconInfo = make(<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.7h.01" /></>);
export const IconAlert = make(<><path d="M12 4 21 19.5H3L12 4Z" /><path d="M12 10v4.5M12 17h.01" /></>);
export const IconNavigation = make(<path d="m4 11 16-7-7 16-2-7-7-2Z" />);
export const IconFilter = make(<path d="M4 6h16M7 12h10M10 18h4" />);
export const IconDownload = make(<><path d="M12 4v11.5M7.5 11 12 15.5 16.5 11" /><path d="M5 20h14" /></>);
export const IconImage = make(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m4 17.5 5-4.5 4 3.5 3-2.5 4.5 3.5" /></>);
export const IconLock = make(<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>);
export const IconExternal = make(<><path d="M14 4.5h5.5V10M19.5 4.5 11 13" /><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></>);
export const IconFlag = make(<><path d="M5.5 21V4.5" /><path d="M5.5 4.5h11l-2 4 2 4h-11" /></>);
export const IconRefresh = make(<><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4.5H15" /></>);
