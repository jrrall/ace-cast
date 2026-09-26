import httpx
import pytest

from forge.client import ContentClient, ContentAPIError


def test_corpus_reads_all_pages_including_old_denied_cards(settings):
    cursors = []
    def respond(request):
        cursor = request.url.params.get('before')
        cursors.append(cursor)
        if cursor is None:
            return httpx.Response(200, json={'cards': [{'id': 9, 'text': 'new'}], 'next_before': 9})
        return httpx.Response(200, json={
            'cards': [{'id': 1, 'text': 'old rejected joke', 'status': 'denied'}],
            'next_before': None,
        })
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        cards = ContentClient(settings, http).list_cards()
    assert cursors == [None, '9']
    assert cards[-1]['status'] == 'denied'


def test_nonadvancing_cursor_fails_instead_of_looping(settings):
    with httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(
        200, json={'cards': [{'id': 9}], 'next_before': 9}
    ))) as http:
        with pytest.raises(ContentAPIError, match='cursor'):
            ContentClient(settings, http).list_cards()
