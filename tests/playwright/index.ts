export function random_sample<T>(input_list: T[], n_samples: number): T[] {
  // If the subset size is greater than the list size, return the original list
  if (n_samples >= input_list.length) {
    return input_list
  }

  // Generate a random subset
  const rand_sample = []
  const used_indices = new Set()

  while (rand_sample.length < n_samples) {
    const rand_idx = Math.floor(Math.random() * input_list.length)
    if (!used_indices.has(rand_idx)) {
      rand_sample.push(input_list[rand_idx])
      used_indices.add(rand_idx)
    }
  }

  return rand_sample
}
