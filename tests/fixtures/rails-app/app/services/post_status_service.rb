class PostStatusService < BaseService
  def call(account, options = {})
    @status = Status.create!(account: account, text: options[:text])
    ProcessMentionsService.new.call(@status)
    DistributionWorker.perform_async(@status.id)
    ActivityPub::DistributionWorker.perform_async(@status.id)
    LinkCrawlWorker.perform_in(1.minute, @status.id)
    @status
  end
end
