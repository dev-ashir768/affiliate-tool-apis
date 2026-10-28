/** TikTok Shop Creator Marketplace niche category ids → display names. */
export const MARKETPLACE_CATEGORY_NAMES: Readonly<Record<string, string>> = {
  "605196": "Automotive & Motorcycle",
  "602284": "Baby & Maternity",
  "601450": "Beauty & Personal Care",
  "801928": "Books, Magazines & Audio",
  "951432": "Collectibles",
  "601755": "Computers & Office Equipment",
  "605248": "Fashion Accessories",
  "700437": "Food & Beverages",
  "604453": "Furniture",
  "700645": "Health",
  "604968": "Home Improvement",
  "600001": "Home Supplies",
  "600942": "Household Appliances",
  "953224": "Jewelry Accessories & Derivatives",
  "802184": "Kids' Fashion",
  "600024": "Kitchenware",
  "824584": "Luggage & Bags",
  "824328": "Menswear & Underwear",
  "602118": "Pet Supplies",
  "601739": "Phones & Electronics",
  "856720": "Pre-Owned",
  "601352": "Shoes",
  "603014": "Sports & Outdoor",
  "600154": "Textiles & Soft Furnishings",
  "604579": "Tools & Hardware",
  "604206": "Toys & Hobbies",
  "601152": "Womenswear & Underwear",
};

export function formatMarketplaceCategories(ids: string[]): string[] {
  return ids.map((id) => MARKETPLACE_CATEGORY_NAMES[id] ?? id);
}
