# Deployment

Deployment files live here; the application source stays in `backend/` and
`frontend/`. Paths below assume commands are run from the repository root.

```bash
cp .env.example .env
docker compose --env-file .env -f deployment/compose.yaml up -d --build
```

Compose resolves build contexts to the repository root and reads the same root
`.env`. Existing Docker volume names, application data paths, Kubernetes namespace
and deployment names are unchanged.

- `docker/`: Dockerfiles, nginx configuration and the Linux dependency lock.
- [k8s/](k8s/README.md): Kubernetes manifests and monitoring.
- [terraform/](terraform/README.md): VM provisioning; run its CLI from that folder.
- [ansible/](ansible/README.md): VM configuration; run its CLI from that folder.

Python runtime dependencies remain in root `requirements.txt`. Windows portable
build dependencies belong to `packaging/requirements-build.txt`, not the Linux
container lock. Generated output and diagnostic logs belong under `build/`.
