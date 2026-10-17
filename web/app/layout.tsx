import './globals.css';
import Nav from '../components/Nav';
export const metadata = { title: 'Bouquet — gifts grown by friends' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Nav /><main>{children}</main><footer>Made with petals at DubHacks ’26 · Visa · T-Mobile · Cloudflare · xAI</footer></body></html>;
}
