import next from 'eslint-config-next'

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...next,
  { rules: { '@next/next/no-img-element': 'off' } },
]

export default config
