interface MockWebPageProps {
  title?: string | undefined
}

/** Fake page shown in the browser viewport while running as plain web content. */
export function MockWebPage({ title }: MockWebPageProps) {
  return (
    <div className="mock-page">
      <div className="mock-page-bar">
        <span className="mock-page-dot" />
        <span className="mock-page-title">{title ?? 'Site preview'}</span>
      </div>
      <div className="mock-page-body">
        <div className="mock-page-hero">
          <h2>Welcome to your site</h2>
          <p>
            This is a web preview of the page. In the desktop app the real page renders here inside the
            built-in browser, and the agent can inspect and drive it.
          </p>
        </div>
        <div className="mock-page-grid">
          <div className="mock-page-card"><span />Card</div>
          <div className="mock-page-card"><span />Card</div>
          <div className="mock-page-card"><span />Card</div>
        </div>
      </div>
    </div>
  )
}
