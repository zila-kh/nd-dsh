use anyhow::{Context, Result, bail};
use nd_agent::{AgentServer, JsonLineWriter, session::SessionStore};
use std::io::{self, BufReader};
use std::sync::Arc;

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("serve")
        || args.next().as_deref() != Some("--stdio")
        || args.next().as_deref() != Some("--data-dir")
    {
        bail!("usage: nd-agent serve --stdio --data-dir <ND-owned session directory>");
    }
    let root = args.next().context("ND agent data directory is required")?;
    if args.next().is_some() {
        bail!("unexpected ND agent argument");
    }
    let store = SessionStore::open(root)?;
    let writer = Arc::new(JsonLineWriter::new(io::stdout()));
    let server = AgentServer::new(store, writer);
    server.serve(BufReader::new(io::stdin()))
}
