# Dados da avaliação do ResilientChain

As bases técnicas vêm da consolidação da campanha definitiva de 9 de agosto de 2026, identificada na origem como `dissertacao-final-20x-20260809`. Elas sustentam o capítulo *Resultado da Avaliação Experimental*. A avaliação de usabilidade foi realizada separadamente e está representada pelas frequências do apêndice da dissertação.

| Base | Registros | Uso na dissertação |
| --- | ---: | --- |
| [Desempenho](performance-results.csv) | 180 | Latência, vazão, integridade e composição do tempo por tamanho de arquivo. |
| [Concorrência](concurrency-results.csv) | 120 | Fluxos com duas ou quatro solicitações simultâneas, incluindo as respostas HTTP 429. |
| [Resiliência](resilience-results.csv) | 90 | Falhas isoladas e combinadas e degradação com quatro, três ou dois nós ativos. |
| [Metadados dos processos](process-metadata.csv) | 178 | Cobertura e diversidade dos processos de BIA sintéticos. |
| [Gás de desempenho e concorrência](blockchain-gas-results.csv) | 634 | Consumo de gás observado na criação do processo, no armazenamento da PMK e na associação de arquivos. |
| [Gás de resiliência](resilience-gas-results.csv) | 60 | Transações confirmadas nas verificações de escrita. |
| [Intervalos entre blocos](block-intervals.csv) | 7.428 | Cadência da produção de blocos nas janelas observadas. |
| [CloudWatch](cloudwatch-final-samples.csv) | 1.440 | CPU, tráfego e verificações de estado EC2 na janela final de 180 minutos. |
| [Memória e disco](system-final-snapshot.csv) | 5 | Uma medição final por instância, coletada via SSM. |
| [Repositórios IPFS](kubo-final-snapshot.csv) | 20 | Cinco medidas finais por nó Kubo, incluindo o tamanho em bytes e em MiB. |
| [Usabilidade, questões fechadas](usability-closed.csv) | 12 | Frequências por categoria de resposta dos cinco participantes consentidos. |
| [Usabilidade, questão aberta](usability-open.csv) | 4 | Temas e frequências publicados na dissertação. Três participantes comentaram e uma resposta pode contribuir para mais de um tema. |

## Como ler os dados

- Os CSVs usam UTF-8, vírgula como separador de campos e ponto como separador decimal. Campos vazios indicam ausência de medição.
- Para as estatísticas de tempo e vazão em desempenho e concorrência, selecione os fluxos com `success=true`. Para a taxa de conclusão, mantenha todas as tentativas no denominador. A dispersão usa o desvio-padrão populacional e o p95 usa interpolação linear.
- Campos com sufixo `_ms` estão em milissegundos. Os tamanhos de arquivo e as taxas de transferência usam múltiplos binários. Para obter MiB/s, divida as taxas em KiB/s por 1.024. As impressões SHA-256 permitem verificar a igualdade entre os arquivos sintéticos originais e os recuperados.
- Em resiliência, `outcome_matches_expectation` indica se o resultado correspondeu ao cenário. Com dois validadores ativos, a ausência de novas escritas era esperada. O gás é contabilizado por transação confirmada e inclui transações de fluxos interrompidos após a confirmação. Na rede privada, o preço observado do gás foi zero. As estimativas em reais da dissertação aplicam uma premissa ilustrativa às medições de gás.
- A CPU e o tráfego têm 36 pontos de cinco minutos por instância. O estado EC2 tem 180 pontos por instância. Para o tráfego acumulado, some `sum` nos pontos `NetworkIn` e `NetworkOut`, em bytes. A memória e o disco são medições pontuais do estado final.

Os valores de medição foram preservados. A cópia omite CIDs, endereços e identificadores de infraestrutura, referências opacas de processos e mensagens brutas de erro. As transações recebem aliases consistentes entre as bases e os erros são apresentados por categoria. As tabelas de usabilidade contêm frequências e temas agregados, sem respostas individuais, datas ou comentários literais.
