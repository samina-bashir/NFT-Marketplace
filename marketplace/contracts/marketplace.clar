;;Traits used
(use-trait sip-009 .sip-009.sip009-nft-trait)
(use-trait sip-010 .sip-010.sip010-ft-trait)

;;Error constants
(define-constant err-ftContract-not-permitted (err u10))
(define-constant err-nftContract-not-same (err u11))
(define-constant err-listingUndefined (err u12))
(define-constant err-notAuthorized (err u13))
(define-constant err-listingExpired (err u14))
(define-constant err-buyer-other-than-specified (err u15))
(define-constant err-ftContract-not-same (err u16))
(define-constant err-owner-trying-to-buy (err u17))
(define-constant err-nftContract-not-permitted (err u18))

;;constants
(define-constant owner tx-sender)

;;maps
(define-map listingData uint {
		nftOwner: principal,
		buyer: (optional principal),
		tokenId: uint,
		nftContract: principal,
		expiry: uint,
		price: uint,
		ftContract: (optional principal)
	}
)
(define-map allowed-NFTContracts principal bool)

;;variables
(define-data-var listingID uint u0)

;;private functions
(define-private (transfer-nft (contract <sip-009>) (tokenId uint) (sender principal) (recipient principal))
	(contract-call? contract transfer tokenId sender recipient)
)
(define-private (transfer-ft (contract <sip-010>) (amount uint) (sender principal) (recipient principal))
	(contract-call? contract transfer amount sender recipient none)
)
(define-private (assert-can-fulfil (nftContract principal) (ftContract (optional principal)) (listingDetails {
    nftOwner: principal, 
    buyer: (optional principal), 
    tokenId: uint, 
    nftContract: principal, 
    expiry: uint, 
    price: uint, 
    ftContract: (optional principal)
    }))
	(begin
		(asserts! (not (is-eq (get nftOwner listingDetails) tx-sender)) err-owner-trying-to-buy)
		(asserts! 
		   (match (get buyer listingDetails) buyerPrincipal (is-eq buyerPrincipal tx-sender) true) 
		   err-buyer-other-than-specified
		)
		(asserts! (< block-height (get expiry listingDetails)) err-listingExpired)
		(asserts! (is-eq (get nftContract listingDetails) nftContract) err-nftContract-not-same)
		(asserts! (is-eq (get ftContract listingDetails) ftContract) err-ftContract-not-same)
		(ok true)
	)
)

;;read-only functions
(define-read-only (isAllowed (contract principal))
	(default-to false (map-get?  allowed-NFTContracts contract))
)
(define-read-only (get-listing (listingId uint))
	(map-get? listingData listingId)
)

;;public functions
(define-public (setAllowed (contract principal) (allowed bool))
	(begin
		(asserts! (is-eq owner tx-sender) err-notAuthorized)
		(ok (map-set allowed-NFTContracts contract allowed))
	)
)
(define-public (list-asset (nftContract <sip-009>) (nftData {
    buyer: (optional principal), 
    tokenId: uint, 
    expiry: uint, 
    price: uint, 
    ftContract: (optional principal)
    }))
	(begin
		(asserts! (isAllowed (contract-of nftContract)) err-nftContract-not-permitted)
		(asserts! (> (get expiry nftData) block-height) err-listingExpired)
		(asserts! (match (get ftContract nftData) ftAsset (isAllowed ftAsset) true) err-ftContract-not-permitted)
		(try! (transfer-nft nftContract (get tokenId nftData) tx-sender (as-contract tx-sender)))
		(map-set listingData (var-get listingID) (merge {nftOwner: tx-sender, nftContract: (contract-of nftContract)} nftData))
		(var-set listingID (+ (var-get listingID) u1))
		(ok true)
	)
)
(define-public (cancel-listing (listingId uint) (nftContract <sip-009>))
	(begin	
		(asserts! (is-eq (get nftOwner (unwrap! (map-get? listingData listingId) err-listingUndefined)) tx-sender) err-notAuthorized)
		(asserts! (is-eq 
		   (get nftContract (unwrap! (map-get? listingData listingId) err-listingUndefined)) 
		   (contract-of nftContract)
		   ) 
		   err-nftContract-not-same
		)
		(map-delete listingData listingId)
		(as-contract (transfer-nft nftContract 
		   (get tokenId (unwrap! (map-get? listingData listingId) err-listingUndefined)) 
		   tx-sender 
		   (get nftOwner (unwrap! (map-get? listingData listingId) err-listingUndefined))
		))
	)
)
(define-public (fulfil-listing-stx (listingId uint) (nftContract <sip-009>))
	(let
	    (
			(listingTuple (unwrap! (map-get? listingData listingId) err-listingUndefined))
			(buyer tx-sender)
		)
		(try! (assert-can-fulfil (contract-of nftContract) none listingTuple))
		(try! (as-contract (transfer-nft nftContract (get tokenId listingTuple) tx-sender buyer)))
		(try! (stx-transfer? (get price listingTuple) buyer (get nftOwner listingTuple)))
		(map-delete listingData listingId)
		(ok listingId)
	)
)

(define-public (fulfil-listing-ft (listingId uint) (nftContract <sip-009>) (ftContract <sip-010>))
	(let (
		(listingTuple (unwrap! (map-get? listingData listingId) err-listingUndefined))
		(buyer tx-sender)
		)
		(try! (assert-can-fulfil (contract-of nftContract) (some (contract-of ftContract)) listingTuple))
		(try! (as-contract (transfer-nft nftContract (get tokenId listingTuple) tx-sender buyer)))
		(try! (transfer-ft ftContract (get price listingTuple) buyer (get nftOwner listingTuple)))
		(map-delete listingData listingId)
		(ok listingId)
	)
)

