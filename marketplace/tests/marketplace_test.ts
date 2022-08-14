
import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v0.31.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

const contractName = 'marketplace';

const defaultNftContract = 'nft';
const defaultFtContract = 'ft';

const contractPrincipal = (deployer: Account) => `${deployer.address}.${contractName}`;

function mintNft({ chain, deployer, recipient, nftContract = defaultNftContract }: { chain: Chain, deployer: Account, recipient: Account, nftContract?: string }) {
	const block = chain.mineBlock([
		Tx.contractCall(nftContract, 'mint', [types.principal(recipient.address),types.none()], deployer.address),
	]);
	block.receipts[0].result.expectOk();
	const nftMintEvent = block.receipts[0].events[0].nft_mint_event;
	const [nftContractPrincipal, nftAssetId] = nftMintEvent.asset_identifier.split('::');
	return { nftContract: nftContractPrincipal, nftAssetId, tokenId: nftMintEvent.value.substr(1), block };
}

function mintFt({ chain, deployer, amount, recipient, ftContract = defaultFtContract }: { chain: Chain, deployer: Account, amount: number, recipient: Account, ftContract?: string }) {
	const block = chain.mineBlock([
		Tx.contractCall(ftContract, 'mint', [types.uint(amount), types.principal(recipient.address)], deployer.address),
	]);
	block.receipts[0].result.expectOk();
	const ftMintEvent = block.receipts[0].events[0].ft_mint_event;
	const [paymentContractPrincipal, ftId] = ftMintEvent.asset_identifier.split('::');
	return { ftContract: paymentContractPrincipal, ftId, block };
}

interface Sip009NftTransferEvent {
	type: string,
	nft_transfer_event: {
		asset_identifier: string,
		sender: string,
		recipient: string,
		value: string
	}
}

function assertNftTransfer(event: Sip009NftTransferEvent, nftContract: string, tokenId: string, sender: string, recipient: string) {
	assertEquals(typeof event, 'object');
	assertEquals(event.type, 'nft_transfer_event');
	assertEquals(event.nft_transfer_event.asset_identifier.substr(0, nftContract.length), nftContract);
	types.principal(event.nft_transfer_event.sender).expectPrincipal(sender);
	types.principal(event.nft_transfer_event.recipient).expectPrincipal(recipient);
	types.ascii(event.nft_transfer_event.value).expectAscii(tokenId);
}

interface Order {
	buyer?: string,
	tokenId: number,
	expiry: number,
	price: number,
	ftContract?: string
}

const makeOrder = (order: Order) =>
	types.tuple({
		'buyer': order.buyer ? types.some(types.principal(order.buyer)) : types.none(),
		'tokenId': types.uint(order.tokenId),
		'expiry': types.uint(order.expiry),
		'price': types.uint(order.price),
		'ftContract': order.ftContract ? types.some(types.principal(order.ftContract)) : types.none(),
	});

const whitelistAssetTx = (assetContract: string, whitelisted: boolean, contractOwner: Account) =>
	Tx.contractCall(contractName, 'setAllowed', [types.principal(assetContract), types.bool(whitelisted)], contractOwner.address);

const listOrderTx = (nftContract: string, maker: Account, order: Order | string) =>
	Tx.contractCall(contractName, 'list-asset', [types.principal(nftContract), typeof order === 'string' ? order : makeOrder(order)], maker.address);

    Clarinet.test({
        name: "Can list an NFT for sale for STX",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const order: Order = { tokenId, expiry: 10, price: 10 };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),

                listOrderTx(nftContract, maker, order)
            ]);
            block.receipts[1].result.expectOk().expectBool(true);
            assertNftTransfer(block.receipts[1].events[0], nftContract, types.uint(tokenId), types.principal(maker.address), types.principal(contractPrincipal(deployer)));
        }
    });
    
    Clarinet.test({
        name: "Can list an NFT for sale for any SIP010 fungible token",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const { ftContract } = mintFt({ chain, deployer, recipient: maker, amount: 1 });
            const order: Order = { tokenId, expiry: 10, price: 10, ftContract };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                whitelistAssetTx(ftContract, true, deployer),
                listOrderTx(nftContract, maker, order)
            ]);
            block.receipts[2].result.expectOk().expectBool(true);
            assertNftTransfer(block.receipts[2].events[0], nftContract, types.uint(tokenId), types.principal(maker.address), types.principal(contractPrincipal(deployer)));
        }
    });
    
    Clarinet.test({
        name: "Cannot list an NFT for sale if the expiry is in the past",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const expiry = 10;
            const order: Order = { tokenId, expiry, price: 10 };
            chain.mineEmptyBlockUntil(expiry + 1);
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                listOrderTx(nftContract, maker, order)
            ]);
            block.receipts[1].result.expectErr().expectUint(14);
            assertEquals(block.receipts[1].events.length, 0);
        }
    });
    
    
    Clarinet.test({
        name: "Cannot list an NFT for sale that the sender does not own",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: deployer });
            const order: Order = { tokenId, expiry: 10, price: 10 };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                listOrderTx(nftContract, maker, order)
            ]);
            block.receipts[1].result.expectErr().expectUint(1);
            assertEquals(block.receipts[1].events.length, 0);
        }
    });
    
    Clarinet.test({
        name: "Maker can cancel a listing",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const order: Order = { tokenId, expiry: 10, price: 10 };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                listOrderTx(nftContract, maker, order),
                Tx.contractCall(contractName, 'cancel-listing', [types.uint(0), types.principal(nftContract)], maker.address)
            ]);
            block.receipts[2].result.expectOk().expectBool(true);
           
            assertNftTransfer(block.receipts[2].events[0], nftContract, types.uint(tokenId), types.principal(contractPrincipal(deployer)), types.principal(maker.address));
        }
    });
    
    Clarinet.test({
        name: "Non-maker cannot cancel listing",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const otherAccount=accounts.get('wallet_2')!;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const order: Order = { tokenId, expiry: 10, price: 10 };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                listOrderTx(nftContract, maker, order),
                Tx.contractCall(contractName, 'cancel-listing', [types.uint(0), types.principal(nftContract)], otherAccount.address)
            ]);
            block.receipts[2].result.expectErr().expectUint(13);
            assertEquals(block.receipts[2].events.length, 0);
        }
    });
    
    Clarinet.test({
        name: "Can get listings that have not been cancelled",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const order: Order = { tokenId, expiry: 10, price: 10 };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                listOrderTx(nftContract, maker, order)
            ]);
            const listingIdUint = types.uint(0);
            const receipt = chain.callReadOnlyFn(contractName, 'get-listing', [listingIdUint], deployer.address);
            assertEquals(receipt.result.expectSome().expectTuple(),{
                buyer: types.none(), 
                expiry: types.uint(order.expiry),
                ftContract: types.none(),
                nftContract: nftContract,
                nftOwner:maker.address,
                price: types.uint(order.price),
                tokenId: types.uint(order.tokenId)
            });
       

        }
    });
    
    Clarinet.test({
        name: "Cannot get listings that have been cancelled or do not exist",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const order: Order = { tokenId, expiry: 10, price: 10 };
            const block=chain.mineBlock([
                listOrderTx(nftContract, maker, order),
                Tx.contractCall(contractName, 'cancel-listing', [types.uint(0), types.principal(nftContract)], maker.address)
            ]);
            assertEquals(block.receipts.length,2);
            const receipt=chain.callReadOnlyFn(contractName, 'get-listing', [types.uint(0)], deployer.address);
            const receipts=chain.callReadOnlyFn(contractName, 'get-listing', [types.uint(99)], deployer.address);
            receipts.result.expectNone();
            receipt.result.expectNone();
        }
    });
    
    Clarinet.test({
        name: "Can fulfil an active listing with STX",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const taker=  accounts.get('wallet_2')!;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const order: Order = { tokenId, expiry: 10, price: 10 };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                listOrderTx(nftContract, maker, order),
                Tx.contractCall(contractName, 'fulfil-listing-stx', [types.uint(0), types.principal(nftContract)], taker.address)
            ]);
            block.receipts[2].result.expectOk().expectUint(0);
            assertNftTransfer(block.receipts[2].events[0], nftContract, types.uint(tokenId), types.principal(contractPrincipal(deployer)), types.principal(taker.address));
            block.receipts[2].events.expectSTXTransferEvent(order.price, taker.address, maker.address);
        }
    });
    
    Clarinet.test({
        name: "Can fulfil an active listing with SIP010 fungible tokens",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const taker=  accounts.get('wallet_2')!;
            const price = 50;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const { ftContract, ftId } = mintFt({ chain, deployer, recipient: taker, amount: price });
            const order: Order = { tokenId, expiry: 10, price, ftContract };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                whitelistAssetTx(ftContract, true, deployer),
                listOrderTx(nftContract, maker, order),
                Tx.contractCall(contractName, 'fulfil-listing-ft', [types.uint(0), types.principal(nftContract), types.principal(ftContract)], taker.address)
            ]);
            block.receipts[3].result.expectOk().expectUint(0);
            
            assertNftTransfer(block.receipts[3].events[0], nftContract, types.uint(tokenId), types.principal(contractPrincipal(deployer)), types.principal(taker.address));
            block.receipts[3].events.expectFungibleTokenTransferEvent(price,taker.address, maker.address, ftId);
        }
    });
    
    Clarinet.test({
        name: "Cannot fulfil own listing",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const order: Order = { tokenId, expiry: 10, price: 10 };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                listOrderTx(nftContract, maker, order),
                Tx.contractCall(contractName, 'fulfil-listing-stx', [types.uint(0), types.principal(nftContract)], maker.address)
            ]);
            block.receipts[2].result.expectErr().expectUint(17);
            assertEquals(block.receipts[2].events.length, 0);
        }
    });
    
    Clarinet.test({
        name: "Cannot fulfil an unknown listing",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const taker=  accounts.get('wallet_2')!;
            const { nftContract } = mintNft({ chain, deployer, recipient: maker });
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                Tx.contractCall(contractName, 'fulfil-listing-stx', [types.uint(0), types.principal(nftContract)], taker.address)
            ])
            block.receipts[1].result.expectErr().expectUint(12);
            assertEquals(block.receipts[1].events.length, 0);
        }
    });
    
    Clarinet.test({
        name: "Cannot fulfil an expired listing",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const taker=  accounts.get('wallet_2')!;
            const expiry = 10;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const order: Order = { tokenId, expiry, price: 10 };
            chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                listOrderTx(nftContract, maker, order),
            ]);
            chain.mineEmptyBlockUntil(expiry + 1);
            const block = chain.mineBlock([
                Tx.contractCall(contractName, 'fulfil-listing-stx', [types.uint(0), types.principal(nftContract)], taker.address)
            ])
            block.receipts[0].result.expectErr().expectUint(14);
            assertEquals(block.receipts[0].events.length, 0);
        }
    });
    
    Clarinet.test({
        name: "Cannot fulfil an active STX listing with SIP010 fungible tokens",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const taker=  accounts.get('wallet_2')!;
            const price = 50;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const { ftContract } = mintFt({ chain, deployer, recipient: taker, amount: price });
            const order: Order = { tokenId, expiry: 10, price };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                whitelistAssetTx(ftContract, true, deployer),
                listOrderTx(nftContract, maker, order),
                Tx.contractCall(contractName, 'fulfil-listing-ft', [types.uint(0), types.principal(nftContract), types.principal(ftContract)], taker.address)
            ]);
            block.receipts[3].result.expectErr().expectUint(16);
            assertEquals(block.receipts[3].events.length, 0);
        }
    });
    
    Clarinet.test({
        name: "Cannot fulfil an active SIP010 fungible token listing with STX",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const taker=  accounts.get('wallet_2')!;
            const price = 50;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const { ftContract } = mintFt({ chain, deployer, recipient: taker, amount: price });
            const order: Order = { tokenId, expiry: 10, price, ftContract };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                whitelistAssetTx(ftContract, true, deployer),
                listOrderTx(nftContract, maker, order),
                Tx.contractCall(contractName, 'fulfil-listing-stx', [types.uint(0), types.principal(nftContract)], taker.address)
            ]);
            block.receipts[3].result.expectErr().expectUint(16);
            assertEquals(block.receipts[3].events.length, 0);
        }
    });
    
    Clarinet.test({
        name: "Cannot fulfil an active STX listing with insufficient balance",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const taker=  accounts.get('wallet_2')!;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const order: Order = { tokenId, expiry: 10, price: taker.balance + 10 };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                listOrderTx(nftContract, maker, order),
                Tx.contractCall(contractName, 'fulfil-listing-stx', [types.uint(0), types.principal(nftContract)], taker.address)
            ]);
            block.receipts[2].result.expectErr().expectUint(1);
            assertEquals(block.receipts[2].events.length, 0);
        }
    });
    
    Clarinet.test({
        name: "Cannot fulfil an active SIP010 fungible token listing with insufficient balance",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const deployer=  accounts.get('deployer')!;
            const maker=  accounts.get('wallet_1')!;
            const taker=  accounts.get('wallet_2')!;
            const price = 50;
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const { ftContract } = mintFt({ chain, deployer, recipient: taker, amount: price });
            const order: Order = { tokenId, expiry: 10, price: taker.balance + 10, ftContract };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                whitelistAssetTx(ftContract, true, deployer),
                listOrderTx(nftContract, maker, order),
                Tx.contractCall(contractName, 'fulfil-listing-ft', [types.uint(0), types.principal(nftContract), types.principal(ftContract)], taker.address)
            ]);
            block.receipts[3].result.expectErr().expectUint(1);
            assertEquals(block.receipts[3].events.length, 0);
        }
    });
    
    Clarinet.test({
        name: "Intended taker can fulfil active listing",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const [deployer, maker, taker] = ['deployer', 'wallet_1', 'wallet_2'].map(name => accounts.get(name)!);
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const order: Order = { tokenId, expiry: 10, price: 10, buyer: taker.address };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                listOrderTx(nftContract, maker, order),
                Tx.contractCall(contractName, 'fulfil-listing-stx', [types.uint(0), types.principal(nftContract)], taker.address)
            ]);
            block.receipts[2].result.expectOk().expectUint(0);
            assertNftTransfer(block.receipts[2].events[0], nftContract, types.uint(tokenId), types.principal(contractPrincipal(deployer)), types.principal(taker.address));
            block.receipts[2].events.expectSTXTransferEvent(order.price, taker.address, maker.address);
        }
    });
    
    Clarinet.test({
        name: "Unintended taker cannot fulfil active listing",
        async fn(chain: Chain, accounts: Map<string, Account>) {
            const [deployer, maker, taker, unintendedTaker] = ['deployer', 'wallet_1', 'wallet_2', 'wallet_3'].map(name => accounts.get(name)!);
            const { nftContract, tokenId } = mintNft({ chain, deployer, recipient: maker });
            const order: Order = { tokenId, expiry: 10, price: 10, buyer: taker.address };
            const block = chain.mineBlock([
                whitelistAssetTx(nftContract, true, deployer),
                listOrderTx(nftContract, maker, order),
                Tx.contractCall(contractName, 'fulfil-listing-stx', [types.uint(0), types.principal(nftContract)], unintendedTaker.address)
            ]);
            block.receipts[2].result.expectErr().expectUint(15);
            assertEquals(block.receipts[2].events.length, 0);
        }
    });
    
  