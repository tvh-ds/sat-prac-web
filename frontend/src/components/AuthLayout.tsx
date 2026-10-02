import type { ReactNode } from "react";

export default function AuthLayout({ children, signup = false }: { children: ReactNode; signup?: boolean }) {
  return (
    <main className={`grit-login${signup ? " grit-signup" : ""}`}>
      <div className="grit-login-layout">
        <section className="login-editorial" aria-label="Grit overview">
          <div className="login-brand-row"><span className="login-wordmark">Grit</span></div>
          <div className="login-hero-copy">
            <h1>
              <span className="login-sr-only">Outwork the test.</span>
              <span className="login-headline-visual" aria-hidden="true">
                <span className="login-headline-line">Outwork</span>
                <span className="login-headline-line login-headline-ending">
                  <span>the</span>{" "}
                  <span className="login-word-slot">
                    <span className="login-word login-word-test">test.</span>
                    <span className="login-word login-word-rest">rest.</span>
                  </span>
                </span>
              </span>
            </h1>
            <p>Your all-in-one SAT platform</p>
          </div>
          <ul className="login-feature-strip" aria-label="Practice features">
            <li>Full-length tests</li><li>Focused practice</li><li>Vocabulary review</li>
          </ul>
        </section>
        {children}
      </div>
    </main>
  );
}
