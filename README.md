# tech-office

Despite the name, **tech-office** is built for everyone. It's a clean, easy-to-use collaboration platform designed for non-tech teams, while remaining versatile and powerful enough for software engineering teams.

## Why build this?

Small teams deserve first-class security and a beautiful UI/UX, but the current options are frustrating:
* **MS Teams** is bloated and slow.
* **Slack** is way too expensive.
* **Telegram & WhatsApp** are fine for casual chats, but you lose track of team work, search history gets messy, and files expire after a while. 

We wanted a secure, simple, and beautifully designed alternative that keeps teams aligned without the bloat or the hefty price tag.

## Contributing

Contributions are very welcome. [`CONTRIBUTING.md`](CONTRIBUTING.md) takes you from a
fresh clone to a running stack — prerequisites, the local development setup, how to run
the web and mobile apps, and how to run the tests.

The short version:

```sh
make infra-up             # PostgreSQL and friends, in Docker
make voice-dev-backend    # backend on http://localhost:18080
cd frontend && pnpm install && pnpm --filter web dev
make check-servers        # confirm everything is up
```

## Hosting & Support

* **100% Open Source:** The source code is completely free to self-host. Everything you
  need is in [`deploy/`](deploy/README.md): Docker Swarm stacks for 1 to 7 machines,
  with TLS, backups to S3/R2, and optional monitoring. Prebuilt images live at
  `ghcr.io/nvcnvn/`. There is no Kubernetes deployment in this repository — the compose
  files are a complete blueprint if you would rather run it there.
* **Affordable Hosting:** If you don't want the hassle of self-hosting, we offer a cheap, flat-rate hosted version to cover hardware (CPU, RAM, bandwidth, and storage) with a tiny profit margin to keep the project running. Check it out at [transformar.work](https://transformar.work/).
* **Sponsor:** If you like this project and want to support it, feel free to drop a small sponsor on [GitHub Sponsors](https://github.com/sponsors/nvcnvn).

## Roadmap

* **Documentation:** The `specs/` directory is currently a bit of a draft as we test our Spec-kit AI workflow and make manual fixes. Better, cleaner documentation is on the way.
* **Mobile Apps:** Publishing the mobile app to app stores for demo/testing.
* **CI/CD:** Automating build pipelines for the backend, web client, and Android app.
* **Testing:** Writing and expanding backend integration and frontend E2E test coverage.
* **Paid plans:** Actually let see if there is real demands but I do hope for some pocket change for keep the sever running.
* **AI Integrations:** BYOK with features like auto transcript, auto chat channel summary... and yes, MCP
