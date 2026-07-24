import pytest

from atlas_api import providers


class FakeResponse:
    def __init__(self, text: str, url: str = "https://example.invalid"):
        self.text = text
        self.url = url

    def raise_for_status(self):
        return None


class FakeSession:
    def __init__(self, echoed_sql: str):
        self.echoed_sql = echoed_sql
        self.get_calls = 0

    def post(self, *args, **kwargs):
        return FakeResponse(
            "Your query:<br>"
            f'<span class="query">{self.echoed_sql}</span>'
            '<a href="../tmp/GAMA_abc123.csv">download</a>'
        )

    def get(self, *args, **kwargs):
        self.get_calls += 1
        return FakeResponse("id,redshift\none,0.03\n")


def test_gama_literal_less_than_is_rejected_before_request(monkeypatch):
    session = FakeSession("unused")
    monkeypatch.setattr(providers, "SESSION", session)
    with pytest.raises(ValueError, match="literal '<'"):
        providers._gama_download("SELECT Z FROM T WHERE Z < 0.1")
    assert session.get_calls == 0


def test_gama_changed_echo_is_rejected_before_catalogue_download(monkeypatch):
    submitted = "SELECT Z FROM T WHERE Z BETWEEN 0.02 AND 0.05 LIMIT 2"
    session = FakeSession("SELECT Z FROM T WHERE Z")
    monkeypatch.setattr(providers, "SESSION", session)
    with pytest.raises(providers.UpstreamError, match="altered or truncated"):
        providers._gama_download(submitted)
    assert session.get_calls == 0


def test_gama_exact_echo_is_accepted(monkeypatch):
    submitted = "SELECT g.`DEC` FROM T g LIMIT 1"
    session = FakeSession(submitted)
    monkeypatch.setattr(providers, "SESSION", session)
    rows, url = providers._gama_download(submitted)
    assert rows == [{"id": "one", "redshift": "0.03"}]
    assert url.endswith("/dr4/tmp/GAMA_abc123.csv")
    assert session.get_calls == 1
