"""Guard moved paths, deployment inputs and local documentation links."""
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parent.parent


class ProjectLayoutTests(unittest.TestCase):
    def test_grouped_files_and_unused_files(self):
        for path in ("scripts/windows/install.bat", "scripts/windows/run_backend.bat",
                     "scripts/windows/run_frontend.bat", "scripts/windows/build_portable.bat",
                     "packaging/requirements-build.txt", "deployment/docker/requirements.lock",
                     "deployment/compose.yaml", "deployment/terraform/main.tf",
                     "deployment/ansible/site.yml", "deployment/k8s/30-backend.yaml",
                     "docs/screenshots/replay.png", "run_dev.bat"):
            self.assertTrue((ROOT / path).is_file(), path)
        for path in ("package-lock.json", "backend/requirements_settings.txt", "requirements-build.txt",
                     "docker-compose.yml", "requirements.lock", "install.bat", "run_backend.bat",
                     "run_frontend.bat", "build_portable.bat"):
            self.assertFalse((ROOT / path).exists(), path)
        self.assertTrue((ROOT / "frontend/package-lock.json").is_file())
        self.assertIn("pydantic-settings>=2.0.0", (ROOT / "requirements.txt").read_text())

    def test_compose_build_contexts_and_environment_still_resolve_to_root(self):
        compose_path = ROOT / "deployment/compose.yaml"
        compose = yaml.safe_load(compose_path.read_text())
        self.assertEqual(compose["name"], "counterscout")
        for name, service in compose["services"].items():
            context = (compose_path.parent / service["build"]["context"]).resolve()
            self.assertEqual(context, ROOT)
            dockerfile = context / service["build"]["dockerfile"]
            self.assertTrue(dockerfile.is_file(), dockerfile)
            # COPY input paths are context-relative, not Dockerfile-relative.
            for line in dockerfile.read_text().splitlines():
                if line.startswith("COPY ") and not line.startswith("COPY --from="):
                    for source in line.split()[1:-1]:
                        self.assertTrue((context / source).exists(), f"{dockerfile}: {source}")
            if "env_file" in service:
                self.assertEqual((compose_path.parent / service["env_file"]).resolve(), ROOT / ".env")
        self.assertIn("cs2-meta-engine_app-data", compose["volumes"]["app-data"]["name"])
        self.assertIn("COPY VERSION .", (ROOT / "deployment/docker/backend.Dockerfile").read_text())
        self.assertIn("COPY VERSION /VERSION", (ROOT / "deployment/docker/frontend.Dockerfile").read_text())

    def test_workflow_and_ansible_use_moved_manifests(self):
        workflow = (ROOT / ".github/workflows/deploy.yml").read_text()
        for path in ("deployment/docker/backend.Dockerfile", "deployment/docker/frontend.Dockerfile", "deployment/k8s/"):
            self.assertIn(path, workflow)
        role = (ROOT / "deployment/ansible/roles/cs2_app/tasks/main.yml").read_text()
        self.assertEqual(role.count("{{ app_dir }}/deployment/k8s/"), 2)
        for path in [*ROOT.glob("deployment/**/*.yaml"), *ROOT.glob("deployment/**/*.yml")]:
            list(yaml.safe_load_all(path.read_text(encoding="utf-8")))

    def test_local_markdown_links_exist(self):
        docs = [ROOT / "README.md", *ROOT.glob("deployment/**/README.md"), ROOT / "packaging/README.md"]
        for doc in docs:
            for target in re.findall(r"\]\(([^)]+)\)", doc.read_text(encoding="utf-8")):
                if re.match(r"[a-z]+:|#", target):
                    continue
                local = target.split("#", 1)[0]
                self.assertTrue((doc.parent / local).exists(), f"{doc}: {target}")

    def test_new_terraform_state_paths_stay_ignored(self):
        for path in ("deployment/terraform/terraform.tfstate", "deployment/terraform/terraform.tfvars",
                     "deployment/terraform/.terraform/providers/example", "build/logs/test.log"):
            result = subprocess.run(["git", "check-ignore", "--no-index", path], cwd=ROOT, capture_output=True)
            self.assertEqual(result.returncode, 0, path)


if __name__ == "__main__":
    unittest.main()
