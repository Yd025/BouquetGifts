'use client';
import { useState } from 'react';
import { $ } from '../lib/api';
import Turnstile from './Turnstile';
import Overlay from './Overlay';
/** Click-to-Pay-style sheet. The card number is masked as you type; nothing is charged until checkout. */
export default function PaySheet({ amountCents, recipient, onClose, onPay }: { amountCents: number; recipient: string; onClose: () => void; onPay: (card: string, human: string | null) => Promise<boolean> }) {
  const [raw, setRaw] = useState('4242424242424242'); const [busy, setBusy] = useState(false); const [human, setHuman] = useState<string | null>(null);
  const digits = raw.replace(/\D/g, '').slice(0, 19);
  const masked = digits.length > 4 ? '•••• '.repeat(Math.ceil((digits.length - 4) / 4)).trim() + ' ' + digits.slice(-4) : digits;
  const [show, setShow] = useState(false);
  return <Overlay onClick={onClose}><div className="paysheet" onClick={e => e.stopPropagation()} data-testid="pay-sheet" role="dialog" aria-label="Chip in">
    <div className="row"><b className="grow">For {recipient}’s gift</b><button className="ghost sm" onClick={onClose} aria-label="Close">✕</button></div>
    <div className="payamt">{$(amountCents)}</div><div className="muted" style={{ marginTop: -6 }}>a hold, not a charge</div>
    <div className="visacard"><div className="row"><span className="chipgold" /><span className="grow" /><b className="visa">{digits.startsWith('4') ? 'VISA' : digits.startsWith('5') ? 'MC' : ''}</b></div>
      <input aria-label="Card number" data-testid="card-input" className="cardnum" value={show ? digits.replace(/(\d{4})(?=\d)/g, '$1 ') : masked} onFocus={() => setShow(true)} onBlur={() => setShow(false)}
        onChange={e => setRaw(e.target.value)} inputMode="numeric" />
      <div className="row muted" style={{ fontSize: 12 }}><span className="grow">Test card (demo)</span><span>12/29</span></div></div>
    <Turnstile onToken={setHuman} />
    {human ? <div className="verified" data-testid="human-ok">✓ Security check passed</div> : null}
    <button style={{ width: '100%' }} disabled={busy || human === null || digits.length < 13} data-testid="pay-confirm"
      onClick={async () => { setBusy(true); const ok = await onPay(digits, human); setBusy(false); if (ok) onClose(); }}>{busy ? 'Holding…' : human === null ? 'Checking…' : `Hold ${$(amountCents)}`}</button>
    <p className="muted" style={{ fontSize: 12, textAlign: 'center', margin: 0 }}>You only pay your share if the gift is bought. If not, the hold disappears.</p>
  </div></Overlay>;
}
