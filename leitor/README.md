# Leitor

Leitor de PDF para celular (PWA), publicado em `/leitor/`.

O app extrai o texto do PDF com o pdf.js (copiado em `vendor/pdfjs`) e o reorganiza em
títulos e parágrafos que se ajustam à largura da tela, como um e-reader.

- `leitor-core.mjs`: lógica pura de reorganização, testada em `tests/leitor.test.mjs`:
  - linhas → títulos, parágrafos, itens de lista e tabelas;
  - remoção de cabeçalhos, rodapés e números de página; junção de palavras hifenizadas;
  - **duas colunas**: acha o corredor vazio entre as colunas e lê, em cada faixa da página,
    a coluna esquerda inteira e depois a direita (título/resumo/tabelas largas ficam inteiros);
  - **tabelas**: linhas com células alinhadas viram tabela; células quebradas são juntadas;
  - **listas**: marcadores em texto (•, , -, 1., a)) e marcadores *desenhados* (bolinhas e
    quadradinhos vetoriais, lidos da lista de operações do pdf.js). Travessão de diálogo não conta.
- `leitor-app.mjs`: interface (biblioteca, modo páginas/rolagem, ajustes, sumário, página original).
  Tabelas que não cabem na tela viram cartões ("coluna: valor"). PDFs com senha pedem a senha,
  que fica guardada só no aparelho para reabrir o arquivo.
- `sw.js`: cache para uso offline.

Os PDFs ficam salvos só no aparelho (IndexedDB); nada é enviado a servidor.
Páginas sem texto (PDF escaneado) aparecem como imagem.
