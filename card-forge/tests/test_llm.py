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
