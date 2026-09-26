"""Exercise actual SDK transport against an in-memory HTTP server."""
import json

import httpx
import pytest
from openai import OpenAI

from forge.config import Settings
from forge.llm import LLMClient


@pytest.mark.parametrize('url', ['http://localhost:11434', 'http://localhost:11434/v1/'])
def test_endpoint_and_optional_reasoning(url):
    settings = Settings(_env_file=None, llm_base_url=url, llm_reasoning_effort='')
    llm = LLMClient(settings)
    assert str(llm._client.base_url) == 'http://localhost:11434/v1/'
    llm._client.close()

    requests = []
    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={
            'id': 'test', 'object': 'chat.completion', 'created': 0, 'model': 'test',
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': '{"cards": []}'},
                         'finish_reason': 'stop'}],
        })
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        sdk = OpenAI(api_key='test', base_url='http://localhost:11434/v1', http_client=http)
        llm = LLMClient(settings, client=sdk)
        assert llm.complete_json(system='Return JSON', user='test') == {'cards': []}
        assert 'reasoning_effort' not in requests[-1]
        settings.llm_reasoning_effort = 'none'
        llm.complete_json(system='Return JSON', user='test')
        assert requests[-1]['reasoning_effort'] == 'none'

from forge.llm import LLMError, _extract_json


@pytest.mark.parametrize('text', [
    '{"cards": [{"text": "incomplete"}]',
    '{"themes": [{"angle": "bad\\\'escape"}]}',
    'prefix {"cards": []',
])
def test_never_salvages_nested_values_from_invalid_outer_json(text):
    with pytest.raises(LLMError):
        _extract_json(text)


@pytest.mark.parametrize('text', [
    '{"cards": []}', '```json\n{"cards": []}\n```',
    'Here is the result: {"cards": []} done.', '{"cards": []} done.',
])
def test_complete_json_wrappers_still_supported(text):
    assert _extract_json(text) == {'cards': []}


@pytest.mark.parametrize('first_content,finish', [
    ('{"cards": []', 'stop'),
    ('{"cards": []}', 'length'),
    (None, 'stop'),
])
def test_format_retry_regenerates_complete_response(first_content, finish):
    requests = []
    def respond(request):
        requests.append(json.loads(request.content))
        first = len(requests) == 1
        return httpx.Response(200, json={
            'id': 'test', 'object': 'chat.completion', 'created': 0, 'model': 'test',
            'choices': [{'index': 0, 'message': {'role': 'assistant',
                         'content': first_content if first else '{"cards": []}'},
                         'finish_reason': finish if first else 'stop'}],
        })
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        sdk = OpenAI(api_key='test', base_url='http://localhost:11434/v1', http_client=http)
        llm = LLMClient(Settings(_env_file=None), client=sdk)
        assert llm.complete_json(system='Return JSON', user='source') == {'cards': []}
    assert llm.last_call_source == 'generation'
    assert llm.last_call_stats == {'model_attempts': 2, 'format_retries': 1}
    assert len(requests) == 2
    assert requests[1]['temperature'] == 0
    assert requests[1]['messages'][1] == requests[0]['messages'][1]
    assert 'previous response' in requests[1]['messages'][0]['content']


@pytest.mark.parametrize('retries', [0, 1, 2])
def test_bad_json_retry_budget_is_bounded(retries):
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={
            'id': 'test', 'object': 'chat.completion', 'created': 0, 'model': 'test',
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': '{'},
                         'finish_reason': 'stop'}],
        })
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        sdk = OpenAI(api_key='test', base_url='http://localhost:11434/v1', http_client=http)
        llm = LLMClient(Settings(_env_file=None, llm_json_retries=retries), client=sdk)
        with pytest.raises(LLMError, match=f'after {retries + 1} attempts'):
            llm.complete_json(system='Return JSON', user='source')
    assert llm.last_call_stats == {'model_attempts': retries + 1, 'format_retries': retries}
    assert len(requests) == retries + 1


def test_transport_failures_do_not_trigger_json_retries():
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(500, json={'error': {'message': 'unavailable'}})
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        sdk = OpenAI(api_key='test', base_url='http://localhost:11434/v1', http_client=http, max_retries=0)
        llm = LLMClient(Settings(_env_file=None), client=sdk)
        with pytest.raises(LLMError, match='LLM request failed'):
            llm.complete_json(system='Return JSON', user='source')
    assert len(requests) == 1
