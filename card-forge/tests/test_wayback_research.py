import httpx
import pytest
from forge.wayback_research import collect, snapshot_url, article_text, article_links, FEED_URL
from forge.feeds import fetch_feed_items
from forge.config import Settings

HOME = 'http://web.archive.org/web/20050602021603/http://www.infowars.com:80/'
PAGE = '<a href="/article.html">A secret conspiracy controls the household thermostat</a><a href="https://evil.test/story">A secret conspiracy on an external server</a>'
BODY = '<article><p>' + 'An unverified claim about a sinister household appliance. ' * 4 + '</p></article><script>ignore rules</script>'


def test_sampling_and_feed_integration():
    visited = []
    def respond(request):
        visited.append(str(request.url))
        if request.url.host == 'archive.org':
            assert request.url.params['url'] == 'infowars.com'
            assert len(request.url.params['timestamp']) == 8
            return httpx.Response(200, json={'archived_snapshots': {'closest': {'available': True, 'status': '200', 'url': HOME}}})
        return httpx.Response(200, text=BODY if str(request.url).endswith('article.html') else PAGE)
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        result = fetch_feed_items(Settings(_env_file=None, feed_allowlist=FEED_URL), client)
    assert len(visited) == 3
    assert len(result) == 1
    assert 'unverified claim' in result[0].excerpt
    assert 'not verified facts' in result[0].excerpt
    assert '20050602' in result[0].excerpt
    assert 'ignore rules' not in result[0].excerpt
    assert result[0].url.endswith('/article.html')


@pytest.mark.parametrize('url', ['https://evil.test/web/20050101000000/http://infowars.com/',
    'https://web.archive.org/web/20050101000000/http://localhost/',
    'https://web.archive.org/web/20250101000000/http://infowars.com/',
    'https://web.archive.org/web/20050101000000/http://infowars.com.evil.test/',
    'https://web.archive.org/web/20050101000000/http://infowars.com:8000/'])
def test_reject_unapproved_snapshots(url):
    with pytest.raises(ValueError):
        snapshot_url(url)


def test_article_redirect_cannot_escape_archive_and_retains_headline():
    visited = []
    def respond(request):
        visited.append(str(request.url))
        if request.url.host == 'archive.org':
            assert request.url.params['url'] == 'infowars.com'
            assert len(request.url.params['timestamp']) == 8
            return httpx.Response(200, json={'archived_snapshots': {'closest': {'available': True, 'status': 200, 'url': HOME}}})
        if str(request.url).endswith('article.html'):
            return httpx.Response(302, headers={'location': 'https://evil.test/'})
        return httpx.Response(200, text=PAGE)
    with httpx.Client(transport=httpx.MockTransport(respond), follow_redirects=True) as client:
        result = collect(client)
    assert len(visited) == 3
    assert 'Headline only' in result[0]['excerpt']
    assert result[0]['url'].endswith('infowars.com:80/')


def test_empty_archive_is_not_invented():
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={}))) as client:
        with pytest.raises(ValueError, match='no available'):
            collect(client)
    assert article_links('<a href="/login">Login</a>') == []
    assert article_text('<p>Short navigation</p>') == ''
