"""Fixed product taxonomy (Google product taxonomy, top 2 levels, abridged) for store discovery."""
from __future__ import annotations
import re

TAXONOMY: list[str] = [
    "Animals & Pet Supplies > Pet Supplies",
    "Apparel & Accessories > Clothing",
    "Apparel & Accessories > Shoes",
    "Apparel & Accessories > Jewelry",
    "Apparel & Accessories > Handbags, Wallets & Cases",
    "Apparel & Accessories > Clothing Accessories",
    "Arts & Entertainment > Hobbies & Creative Arts",
    "Baby & Toddler > Baby Transport",
    "Baby & Toddler > Nursing & Feeding",
    "Business & Industrial > Work Safety Protective Gear",
    "Cameras & Optics > Cameras",
    "Electronics > Audio",
    "Electronics > Communications",
    "Electronics > Computers",
    "Electronics > Electronics Accessories",
    "Electronics > Video",
    "Electronics > Video Game Consoles",
    "Food, Beverages & Tobacco > Beverages",
    "Food, Beverages & Tobacco > Food Items",
    "Furniture > Chairs",
    "Furniture > Tables",
    "Furniture > Office Furniture",
    "Furniture > Beds & Accessories",
    "Hardware > Tools",
    "Health & Beauty > Personal Care",
    "Health & Beauty > Health Care",
    "Home & Garden > Kitchen & Dining",
    "Home & Garden > Decor",
    "Home & Garden > Household Appliances",
    "Home & Garden > Lawn & Garden",
    "Home & Garden > Lighting",
    "Home & Garden > Linens & Bedding",
    "Luggage & Bags > Backpacks",
    "Luggage & Bags > Suitcases",
    "Media > Books",
    "Office Supplies > Office Equipment",
    "Sporting Goods > Athletics",
    "Sporting Goods > Exercise & Fitness",
    "Sporting Goods > Outdoor Recreation",
    "Toys & Games > Toys",
    "Toys & Games > Games",
    "Vehicles & Parts > Vehicle Parts & Accessories",
]

_WORD = re.compile(r"[a-z]+")
_SYNONYMS = {
    "headphones": "audio", "earbuds": "audio", "speaker": "audio", "speakers": "audio",
    "laptop": "computers", "laptops": "computers", "phone": "communications", "phones": "communications",
    "boots": "shoes", "sneakers": "shoes", "trainers": "shoes", "footwear": "shoes",
    "hiking": "outdoor", "camping": "outdoor", "tent": "outdoor", "desk": "office",
    "skincare": "personal", "makeup": "personal", "dress": "clothing", "shirt": "clothing", "jacket": "clothing",
}


def _words(text: str) -> set[str]:
    words = set(_WORD.findall(text.lower()))
    return words | {_SYNONYMS[w] for w in words if w in _SYNONYMS}


def normalise_category(raw: str | None) -> str | None:
    """Map free text (LLM output or item title) onto the closest taxonomy path."""
    if not raw:
        return None
    if raw in TAXONOMY:
        return raw
    words = _words(raw)
    best, best_score = None, 0
    for path in TAXONOMY:
        top, _, leaf = path.partition(" > ")
        score = 2 * len(words & _words(leaf)) + len(words & _words(top))
        if score > best_score:
            best, best_score = path, score
    return best


def category_keys(path: str | None) -> list[str]:
    """Stored categories include both levels so cache lookups match broadly."""
    if not path:
        return []
    top = path.split(" > ")[0]
    return [path, top] if top != path else [path]
