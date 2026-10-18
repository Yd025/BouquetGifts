import './globals.css';
import Nav from '../components/Nav';
import Motion from '../components/Motion';
export const metadata = { title: 'Bouquet — chip in on a gift together' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Nav /><main>{children}</main><Motion /></body></html>;
}
