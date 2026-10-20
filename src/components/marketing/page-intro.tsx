export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <div className="page-intro"><p className="eyebrow"><span className="eyebrow-line" />{eyebrow}</p><h1>{title}</h1><div className="intro-description">{children}</div></div>;
}
