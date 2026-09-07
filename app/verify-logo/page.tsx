import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Logo layout check', robots: { index: false, follow: false } };
export default function LogoLayoutCheck() {
  return <section style={{ padding: '24px', background: '#e9eef4' }}>
    <h1 style={{ fontSize: '22px', margin: '0 0 20px' }}>Logo layout check</h1>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '28px', alignItems: 'start' }}>
      {[375, 320, 981].map(width => <div key={width}>
        <h2 style={{ fontSize: '16px', margin: '0 0 12px' }}>Viewport {width}px</h2>
        <iframe title={'Viewport ' + width} src="/" width={width} height={width === 981 ? 220 : 600} style={{ display: 'block', border: '1px solid #cbd5e1', boxSizing: 'content-box', borderRadius: '4px' }} />
      </div>)}
    </div>
  </section>;
}
