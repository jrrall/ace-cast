import random
import httpx
from forge.b3ta import DEFAULT_URL, collect, posts, topic_url
from forge.config import Settings
from forge.feeds import fetch_feed_items


def post(i, title='Ridiculous singers', body='First pun<br>Second pun', replies=True):
    link = f'<a class="reply_post_link_class" href="{DEFAULT_URL}post{i}">2 replies</a>' if replies else ''
    return (f'<div class="post1" id="answers-post-{i}"><b>{title}</b><br>{body}'
            f'(<span class="byline"><a>Author</a><span class="usersig">Signature</span></span>, date,{link})</div>')


def test_clean_posts_preserve_list_and_remove_metadata():
    data = posts('<nav>Menu</nav>' + post(1) + '<script>bad()</script>', DEFAULT_URL)
    assert len(data) == 1
    assert data[0]['text'] == 'Ridiculous singers\nFirst pun\nSecond pun'
    assert data[0]['url'] == DEFAULT_URL + 'post1'
    assert all(word not in data[0]['text'] for word in ['Author', 'Signature', 'date', 'replies', 'Menu'])


def test_bounded_crawl_and_thread_context():
    initial = ''.join(post(i) for i in range(1, 15))
    initial += f'<a href="{DEFAULT_URL}page1/">1</a><a href="https://evil.test/page2/">evil</a>'
    initial += '<a href="/questions/write.php?parent=1">Reply</a>'
    visited = []
    def respond(request):
        visited.append(str(request.url))
        if request.url.path.endswith('page1/'):
            return httpx.Response(200, text=post(30))
        i = int(request.url.path.split('post')[1])
        return httpx.Response(200, text=post(i) + post(100+i, 'Reply riff', 'Extra idea', False))
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        result = collect(initial, DEFAULT_URL, client, rng=random.Random(5))
    assert len(result) == 8
    assert len(visited) == 4
    assert all(url.startswith(DEFAULT_URL) for url in visited)
    assert sum('Replies (same discussion)' in p['text'] for p in result) == 3
    assert all('Unverified forum humor' in p['text'] for p in result)


def test_failure_and_redirect_leave_original_posts():
    calls = []
    def respond(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={'Location': 'https://evil.test/'})
    with httpx.Client(transport=httpx.MockTransport(respond), follow_redirects=True) as client:
        result = collect(post(1), DEFAULT_URL, client)
    assert len(result) == 1
    assert calls == [DEFAULT_URL + 'post1']


def test_feed_integration():
    settings = Settings(_env_file=None, feed_allowlist=DEFAULT_URL)
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text=post(1, replies=False)))) as client:
        items = fetch_feed_items(settings, client)
    assert items[0].source == 'b3ta forum anecdotes'
    assert items[0].url == DEFAULT_URL + 'post1'


def test_topic_boundaries_and_empty_page():
    assert topic_url(DEFAULT_URL)
    assert not topic_url('https://b3ta.com.evil.test/questions/test/')
    assert not topic_url('https://b3ta.com/questions/write.php?topic=1')
    assert posts('<html>Login or challenge page</html>', DEFAULT_URL) == []
