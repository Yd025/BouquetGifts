/** Re-mounts on every navigation, so each page arrives with a short fade-up (opacity/translate only; nothing when reduced motion is on). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="route-in">{children}</div>;
}
