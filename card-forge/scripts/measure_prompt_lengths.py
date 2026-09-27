"""Measure raw black-card text in a JSON Against Humanity full.json export."""
import argparse
import json
from statistics import mean


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', help='Path to cah-all-full.json')
    args = parser.parse_args()
    with open(args.path, encoding='utf-8') as source:
        packs = json.load(source)
    for label, subset in [('all', packs), ('official', [p for p in packs if p.get('official')])]:
        texts = [card['text'] for pack in subset for card in pack['black']]
        print(json.dumps({
            'scope': label, 'packs': len(subset), 'prompts': len(texts),
            'mean_characters': mean(map(len, texts)) if texts else None,
            'mean_words': mean(len(text.split()) for text in texts) if texts else None,
        }))


if __name__ == '__main__':
    main()
