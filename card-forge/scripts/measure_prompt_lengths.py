"""Measure raw prompt or answer text in a JSON Against Humanity full.json export."""
import argparse
import json
from statistics import mean, median


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', help='Path to cah-all-full.json')
    parser.add_argument('--kind', choices=['prompt', 'answer'], default='prompt')
    args = parser.parse_args()
    with open(args.path, encoding='utf-8') as source:
        packs = json.load(source)
    for label, subset in [('all', packs), ('official', [p for p in packs if p.get('official')])]:
        texts = [card['text'] for pack in subset for card in pack['black' if args.kind == 'prompt' else 'white']]
        print(json.dumps({
            'scope': label, 'packs': len(subset), args.kind + 's': len(texts),
            'mean_characters': mean(map(len, texts)) if texts else None,
            'mean_words': mean(len(text.split()) for text in texts) if texts else None,
            'median_words': median(len(text.split()) for text in texts) if texts else None,
            'within_word_limit_percent': {
                str(limit): round(100 * sum(len(text.split()) <= limit for text in texts) / len(texts), 2)
                for limit in (3, 5)
            } if texts else {},
        }))


if __name__ == '__main__':
    main()
