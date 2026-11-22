# ResilientChain

ResilientChain é um protótipo de Análise de Impacto nos Negócios (BIA) para a gestão da continuidade de negócios. A aplicação permite cadastrar processos, definir criticidade e objetivos de recuperação (RTO, RPO e MAO), consultar a matriz e o painel de indicadores e anexar documentos aos processos.

## Contexto acadêmico

O protótipo foi desenvolvido na dissertação *ResilientChain: Uma Abordagem Baseada em Blockchain para a Gestão da Continuidade de Negócios*, de André Luiz Borges de Oliveira, no Mestrado Profissional em Inovação Tecnológica da Universidade Federal de São Paulo (UNIFESP), sob orientação de Arlindo Flavio da Conceição.

A pesquisa seguiu a abordagem *Design Science Research*, apoiada por uma revisão sistemática da literatura. O objetivo foi investigar como uma blockchain permissionada, o armazenamento distribuído e a cifragem no navegador podem preservar a confidencialidade, a integridade e a rastreabilidade dos registros de BIA e permitir sua recuperação durante incidentes.

A avaliação usou dados sintéticos em ensaios de desempenho, concorrência e falhas controladas, com quatro validadores Hyperledger Besu usando IBFT 2.0 e quatro nós Kubo/IPFS. Nas falhas previstas nos ensaios, a replicação preservou o acesso aos arquivos já armazenados. A confirmação de novas transações dependeu da disponibilidade do quórum de consenso. A configuração local descrita abaixo usa Hardhat e um nó Kubo.

## Componentes

| Componente | Função |
| --- | --- |
| `frontend/` | Interface React/Vite, integração com MetaMask e cifragem e decifragem no navegador. |
| `auth-service/` | API Node.js/Express para autenticação por assinatura de um desafio da carteira, emissão de JWT, cadastro de usuários e integração com IPFS. |
| `contracts/` | Contratos Solidity e scripts Hardhat para compilar e implantar em uma rede Ethereum compatível. |
| `docker/` e `docker-compose.yml` | Configuração local do serviço de autenticação e de um nó IPFS Kubo privado. |

O contrato `AccessManager` gerencia os papéis de administrador, analista e leitor, as chaves públicas X25519 e as cópias cifradas da chave de cada processo. O `BIARegistry` registra processos, seus dados cifrados e as mudanças de status. O `BIAFileRegistry` associa metadados cifrados, incluindo o CID do anexo, a uma referência opaca do processo.

O navegador cifra os dados de negócio e os anexos com AES-256-GCM. Os contratos armazenam os dados cifrados dos processos e os metadados cifrados dos anexos. O IPFS armazena o conteúdo cifrado dos arquivos. Eventos, endereços de carteira, status e datas registradas pelos contratos podem ser consultados na blockchain.

## Executar localmente

Você precisa de Node.js 22.13 ou posterior em uma versão LTS, npm, Docker com Docker Compose v2, Make, OpenSSL e um navegador atualizado com MetaMask.

1. Na raiz do repositório, instale as dependências e gere a configuração local. O comando cria `.env` e `swarm.key` na primeira execução.

   ```sh
   make setup
   ```

2. Inicie o nó Ethereum local em um terminal e mantenha-o aberto.

   ```sh
   make node
   ```

3. Em outro terminal, implante os contratos e suba o Kubo e o serviço de autenticação.

   ```sh
   make deploy
   make start
   ```

   O deploy gera as ABIs e os endereços em `frontend/public/contracts/`. A API responde em `http://localhost:3001/api/health`.

4. Inicie a interface em outro terminal e abra `http://localhost:5173`.

   ```sh
   make frontend
   ```

5. No MetaMask, adicione a rede local com RPC `http://127.0.0.1:8545`, chain ID `31337` e símbolo `ETH`. Importe a conta 0 exibida pelo Hardhat, usada no deploy e cadastrada como administradora pelo `.env.example`. Use essa conta apenas na rede local. Ao conectar pela primeira vez, confirme as assinaturas e a transação de registro da chave de cifragem.

Use `make stop` para parar os serviços Docker. O Kubo e o cadastro de usuários usam volumes persistentes. O nó Hardhat mantém o estado em memória. Execute `make deploy` novamente após reiniciá-lo e atualize a página.

Se a porta 8545 já estiver em uso, inicie com `make node HARDHAT_PORT=18545`, use `HARDHAT_NETWORK_URL=http://127.0.0.1:18545 make deploy` e ajuste o RPC no MetaMask.

## Configuração para redes externas

O Hardhat também aceita um RPC Hyperledger Besu. Defina `BESU_RPC_URL`, `BESU_CHAIN_ID` e `DEPLOYER_PRIVATE_KEY` no `.env` local e execute `make deploy DEPLOY_NETWORK=besu`. Configure a mesma rede no MetaMask. O endereço da carteira usada no deploy deve corresponder ao `ADMIN_WALLET` para o primeiro acesso administrativo.

Para usar vários nós Kubo conectados ao mesmo swarm privado, configure no serviço `IPFS_API_URLS` com uma lista de URLs separadas por vírgula e `IPFS_REPLICATION_MIN` com o mínimo de réplicas exigido. A API também aceita o S3 como entrada opcional para o envio segmentado de arquivos cifrados, com `S3_INGRESS_ENABLED`, `S3_INGRESS_BUCKET` e `S3_INGRESS_REGION`.

## Licença

Consulte a [licença Apache 2.0](LICENSE) do repositório e as identificações SPDX nos arquivos Solidity.
