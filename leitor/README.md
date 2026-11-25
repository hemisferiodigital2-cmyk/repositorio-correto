# Leitor

Leitor de PDF para celular (PWA), publicado em `/leitor/`.

O app extrai o texto do PDF com o pdf.js (copiado em `vendor/pdfjs`) e o reorganiza em
títulos e parágrafos que se ajustam à largura da tela, como um e-reader.

- `leitor-core.mjs`: lógica pura de reorganização (linhas → parágrafos/títulos, remoção de
  cabeçalhos, rodapés e números de página, junção de palavras hifenizadas). Testada em
  `tests/leitor.test.mjs`.
- `leitor-app.mjs`: interface (biblioteca, modo páginas/rolagem, ajustes, sumário, página original).
- `sw.js`: cache para uso offline.

Os PDFs ficam salvos só no aparelho (IndexedDB); nada é enviado a servidor.
Páginas sem texto (PDF escaneado) aparecem como imagem.
